import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Local-only preprocessing. The source movie is never copied into public assets.
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/prepare-mascot.mjs <source.mov> [--analyze] (without --analyze, also builds the bundled alpha pose atlases)');
const root = path.resolve(import.meta.dirname, '..');
const sourceSha256 = createHash('sha256').update(await fs.readFile(source)).digest('hex');
const analysisDir = path.join(root, '.test-output/mascot-analysis');
await fs.mkdir(analysisDir, { recursive: true });
const decodedDir = path.join(analysisDir, `decoded-${sourceSha256.slice(0, 12)}`);
await fs.mkdir(decodedDir, { recursive: true });
const run = (exe, args) => {
  const result = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
};
const info = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source]));
const video = info.streams.find((stream) => stream.codec_type === 'video');
const rate = video.avg_frame_rate.split('/').map(Number);
const fps = rate[0] / rate[1];
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-an', '-fps_mode', 'passthrough', '-pix_fmt', 'rgba', path.join(decodedDir, 'frame-%03d.png')]);
const frames = (await fs.readdir(decodedDir)).filter((name) => /^frame-\d+\.png$/.test(name)).sort();
const bounds = [];
for (const filename of frames) {
  const { data, info: raster } = await sharp(path.join(decodedDir, filename)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = raster.width; let top = raster.height; let right = -1; let bottom = -1; let transparent = 0;
  for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
    const alpha = data[(y * raster.width + x) * 4 + 3];
    if (alpha === 0) transparent++;
    if (alpha > 8) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  bounds.push({ filename, frame: bounds.length, time: bounds.length / fps, left, top, right, bottom, transparentFraction: transparent / (raster.width * raster.height) });
}
const selected = bounds.filter((frame) => frame.frame % 8 === 0 || frame.frame === bounds.length - 1);
const width = 256; const height = 174; const columns = 4;
const composites = [];
for (let index = 0; index < selected.length; index++) {
  const frame = selected[index];
  const tile = await sharp(path.join(decodedDir, frame.filename)).resize({ width, height: 144, fit: 'contain', background: '#252934' }).flatten({ background: '#252934' }).png().toBuffer();
  const label = Buffer.from(`<svg width="${width}" height="30"><rect width="100%" height="100%" fill="#11151c"/><text x="8" y="21" fill="white" font-family="Arial" font-size="16">F${frame.frame} / ${frame.time.toFixed(3)}s</text></svg>`);
  composites.push({ input: tile, left: (index % columns) * width, top: Math.floor(index / columns) * height });
  composites.push({ input: label, left: (index % columns) * width, top: Math.floor(index / columns) * height + 144 });
}
await sharp({ create: { width: columns * width, height: Math.ceil(selected.length / columns) * height, channels: 4, background: '#11151c' } }).composite(composites).png().toFile(path.join(analysisDir, 'contact-sheet.png'));
const report = { source: path.basename(source), sourceSha256, video, bounds, contactSheet: path.join(analysisDir, 'contact-sheet.png') };
await fs.writeFile(path.join(analysisDir, 'analysis.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ count: bounds.length, fps, width: video.width, height: video.height, first: bounds[0], last: bounds.at(-1), contactSheet: report.contactSheet }, null, 2));

if (!process.argv.includes('--analyze')) {
  // Fixed framing retains the source head motion. Per-frame auto-cropping would
  // incorrectly stabilize/re-size the face, and destroy overlay alignment.
  // y=9 leaves 471 source rows; add one transparent row to preserve the agreed
  // 522x472 working canvas without trying to read outside the 480px movie.
  const crop = { left: 174, top: 9, width: 522, height: 471 };
  if (video.width !== 854 || video.height !== 480 || bounds.length < 121) {
    throw new Error('This pose calibration requires the supplied 854x480 clip with at least 121 frames. Inspect and recalibrate another source before generating assets.');
  }
  if (!video.pix_fmt?.includes('a')) throw new Error('The source must have a real alpha channel; no background is removed by this script.');
  const outputDir = path.join(root, 'public/brand/onboarding-mascot');
  await fs.mkdir(outputDir, { recursive: true });
  const tileWidth = 512; const tileHeight = 464; const columns = 4; const rowsPerSheet = 4;
  // F0/F144 are never wrapped. A finite bank is sampled by cursor direction.
  const sourceFrames = [16, ...Array.from({ length: 49 }, (_, index) => 24 + index * 2)];
  const tiles = await Promise.all(sourceFrames.map(async (sourceFrame) => {
    // Sharp performs extend after resize within one pipeline. Finish the fixed
    // crop/pad first, then size the tile in a second pipeline to avoid a465px tile.
    const padded = await sharp(path.join(decodedDir, frames[sourceFrame]))
      .extract(crop).extend({ bottom: 1, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const tile = await sharp(padded)
      .resize(tileWidth, tileHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha().png().toBuffer();
    const tileInfo = await sharp(tile).metadata();
    if (tileInfo.width !== tileWidth || tileInfo.height !== tileHeight || !tileInfo.hasAlpha) throw new Error('Invalid alpha pose tile dimensions');
    return tile;
  }));
  const sheets = [];
  const atlasFrames = [];
  const capacity = columns * rowsPerSheet;
  for (let offset = 0; offset < tiles.length; offset += capacity) {
    const sheet = sheets.length;
    const sheetTiles = tiles.slice(offset, offset + capacity);
    const sheetWidth = columns * tileWidth;
    const sheetHeight = Math.ceil(sheetTiles.length / columns) * tileHeight;
    const file = `poses-${sheet}.webp`;
    await sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(sheetTiles.map((input, index) => ({ input, left: (index % columns) * tileWidth, top: Math.floor(index / columns) * tileHeight })))
      .webp({ quality: 91, alphaQuality: 100, effort: 6 }).toFile(path.join(outputDir, file));
    const metadata = await sharp(path.join(outputDir, file)).metadata();
    if (!metadata.hasAlpha) throw new Error(`${file} lost its alpha channel`);
    console.log(`Prepared ${file}: ${sheetWidth}x${sheetHeight}, alpha preserved`);
    sheets.push({ file, width: sheetWidth, height: sheetHeight });
    sheetTiles.forEach((_, index) => atlasFrames.push({ sourceFrame: sourceFrames[offset + index], sheet, x: (index % columns) * tileWidth, y: Math.floor(index / columns) * tileHeight }));
  }
  await sharp(tiles[0]).webp({ quality: 93, alphaQuality: 100, effort: 6 }).toFile(path.join(outputDir, 'poster.webp'));
  const manifest = {
    version: 1,
    width: tileWidth,
    height: tileHeight,
    neutralIndex: 0,
    poster: 'poster.webp',
    sourceSha256,
    sourceFps: fps,
    sourceFrameCount: bounds.length,
    sourceCrop: crop,
    sourcePadding: { bottom: 1 },
    sheets,
    frames: atlasFrames,
    anchors: [
      { angle: 0, sourceFrame: 24 }, { angle: 45, sourceFrame: 40 },
      { angle: 90, sourceFrame: 56 }, { angle: 135, sourceFrame: 72 },
      { angle: 180, sourceFrame: 88 }, { angle: 225, sourceFrame: 96 },
      { angle: 270, sourceFrame: 104 }, { angle: 315, sourceFrame: 112 },
      { angle: 360, sourceFrame: 120 },
    ],
  };
  await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const assetFiles = [...sheets.map((sheet) => sheet.file), 'poster.webp', 'manifest.json'];
  const packagedBytes = (await Promise.all(assetFiles.map(async (file) => (await fs.stat(path.join(outputDir, file))).size))).reduce((sum, size) => sum + size, 0);
  const atlasDecodedBytes = sheets.reduce((sum, sheet) => sum + sheet.width * sheet.height * 4, 0);
  console.log(JSON.stringify({ outputDir, frameCount: atlasFrames.length, sheets, packagedBytes, atlasDecodedBytes, sourceSha256 }, null, 2));
}
