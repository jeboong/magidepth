/* Headless, synthetic-only Electron media transport diagnostics. No user app.
 * node tests/media-protocol-electron.cjs [--new]
 */
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output', 'media-protocol');

if (!process.versions.electron) {
  void (async () => {
  fsSync.mkdirSync(output, { recursive: true });
  for (const [name, codec] of [['h264.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']], ['prores.mov', ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le']]]) {
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '4', ...codec, path.join(output, name)], { encoding: 'utf8', windowsHide: true });
    if (result.status) throw new Error(result.stderr);
  }
  if (process.argv.includes('--new')) {
    const { buildSync } = require('esbuild');
    for (const name of ['media-protocol', 'media-playback']) buildSync({ entryPoints: [path.join(root, 'electron', `${name}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(output, `${name}.cjs`) });
    const { MediaPlaybackManager } = require(path.join(output, 'media-playback.cjs'));
    const executable = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['ffmpeg'], { encoding: 'utf8', windowsHide: true }).stdout.trim().split(/\r?\n/)[0];
    const source = path.join(output, 'prores.mov'); const hashBefore = crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex');
    const manager = new MediaPlaybackManager(path.join(output, 'proxy-cache'));
    const a = await manager.prepare({ jobId: 'synthetic-prores-proxy', source, ffmpeg: executable, duration: 4 });
    const b = await manager.prepare({ jobId: 'synthetic-prores-cache', source, ffmpeg: executable, duration: 4 });
    assert.equal(b.cached, true); assert.equal(a.path, b.path);
    assert.equal(crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex'), hashBefore, 'Proxy conversion must not modify source');
    await fs.writeFile(path.join(output, 'proxy-result.json'), JSON.stringify({ a, b }));
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, ...process.argv.slice(2)], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  child.on('exit', code => { process.exitCode = code || 0; });
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, protocol, net } = require('electron');
  app.setPath('userData', path.join(output, 'isolated-user-data'));
  protocol.registerSchemesAsPrivileged([{ scheme: 'depthdesk', privileges: { standard: true, secure: true, supportFetchAPI: true } }, { scheme: 'depthdesk-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
  const useNew = process.argv.includes('--new');
  app.whenReady().then(async () => {
    const timer = setTimeout(() => { console.error('Media harness timed out'); app.exit(1); }, 45000);
    try {
      const samples = ['h264.mp4', 'prores.mov'].map(name => ({ name, path: path.join(output, name) }));
      if (useNew && fsSync.existsSync(path.join(output, 'proxy-result.json'))) {
        const proxy = JSON.parse(await fs.readFile(path.join(output, 'proxy-result.json'), 'utf8'));
        samples.push({ name: 'prores-compatible-proxy.mp4', path: proxy.a.path });
      }
      const allowed = new Set(samples.map(item => item.path.toLowerCase()));
      if (useNew) {
        const { createMediaProtocolHandler } = require(path.join(output, 'media-protocol.cjs'));
        protocol.handle('depthdesk-media', createMediaProtocolHandler(allowed));
      } else {
        protocol.handle('depthdesk-media', async request => {
          const url = new URL(request.url); const file = await fs.realpath(url.searchParams.get('path'));
          if (url.host !== 'local' || !allowed.has(file.toLowerCase())) return new Response('Forbidden', { status: 403 });
          return net.fetch(pathToFileURL(file).toString(), { headers: request.headers });
        });
      }
      protocol.handle('depthdesk', () => new Response('<!doctype html><html><body></body></html>', { headers: { 'Content-Type': 'text/html' } }));
      const report = { electron: process.versions.electron, transport: useNew ? 'explicit-range' : 'legacy-net-fetch', ranges: [], playback: [] };
      for (const range of [undefined, 'bytes=0-31', 'bytes=64-', 'bytes=-32', 'bytes=999999999-']) {
        try {
          const response = await net.fetch(`depthdesk-media://local/?path=${encodeURIComponent(path.join(output, 'h264.mp4'))}`, { headers: range ? { Range: range } : {} });
          const bytes = (await response.arrayBuffer()).byteLength;
          report.ranges.push({ range: range || '(none)', status: response.status, bytes, headers: Object.fromEntries(response.headers) });
        } catch (error) { report.ranges.push({ range, error: String(error) }); }
      }
      const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
      await win.loadURL('depthdesk://app/');
      for (const sample of samples) {
        const { name } = sample;
        const src = `depthdesk-media://local/?path=${encodeURIComponent(sample.path)}`;
        const result = await win.webContents.executeJavaScript(`(${async function (src) {
          const video = document.createElement('video'); video.muted = true; video.preload = 'auto'; document.body.append(video);
          const events = []; for (const event of ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'seeked', 'error']) video.addEventListener(event, () => events.push({ event, time: video.currentTime, readyState: video.readyState }));
          const wait = (event, ms = 5000) => new Promise((resolve, reject) => { const timeout = setTimeout(() => { cleanup(); reject(new Error(`timeout:${event}`)); }, ms); const cleanup = () => { clearTimeout(timeout); video.removeEventListener(event, done); video.removeEventListener('error', fail); }; const done = () => { cleanup(); resolve(); }; const fail = () => { cleanup(); reject(new Error(`MediaError:${video.error?.code}:${video.error?.message}`)); }; video.addEventListener(event, done, { once: true }); video.addEventListener('error', fail, { once: true }); });
          try {
            const ready = wait('loadeddata'); video.src = src; await ready;
            const duration = video.duration; const seekableBefore = Array.from({ length: video.seekable.length }, (_, i) => [video.seekable.start(i), video.seekable.end(i)]);
            await video.play(); await new Promise(resolve => setTimeout(resolve, 400)); video.pause(); const progressedTo = video.currentTime;
            const seek = wait('seeked'); video.currentTime = 2.5; await seek;
            const result = { ok: true, duration, progressedTo, seekTo: video.currentTime, seekableBefore, events }; video.remove(); return result;
          } catch (error) { const result = { ok: false, error: String(error), mediaError: video.error && { code: video.error.code, message: video.error.message }, events }; video.remove(); return result; }
        }.toString()})(${JSON.stringify(src)})`);
        report.playback.push({ name, ...result });
      }
      win.destroy();
      const target = path.join(output, useNew ? 'explicit-range-report.json' : 'legacy-report.json');
      await fs.writeFile(target, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
      if (useNew) {
        assert.equal(report.ranges[1].status, 206); assert.equal(report.ranges[1].bytes, 32); assert.equal(report.ranges[1].headers['content-length'], '32');
        assert.equal(report.ranges[4].status, 416);
        for (const name of ['h264.mp4', 'prores-compatible-proxy.mp4']) {
          const result = report.playback.find(item => item.name === name); assert.equal(result?.ok, true, `${name}: ${result?.error}`);
          assert.ok(result.progressedTo > .1); assert.equal(result.seekTo, 2.5);
        }
        assert.equal(report.playback.find(item => item.name === 'prores.mov').mediaError.code, 4);
        console.log('PASS explicit byte ranges, H264 playback/seek, ProRes compatibility proxy/cache, original preservation');
      }
      clearTimeout(timer); app.exit(0);
    } catch (error) { clearTimeout(timer); console.error(error); app.exit(1); }
  });
}
