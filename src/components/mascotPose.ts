export interface MascotFrame { sourceFrame: number; sheet: number; x: number; y: number }
export interface MascotManifest {
  version: number;
  width: number;
  height: number;
  neutralIndex: number;
  idleSeamIndex?: number;
  sheets: { file: string; width: number; height: number }[];
  frames: MascotFrame[];
  anchors: { angle: number; sourceFrame: number }[];
  seam?: { fromSourceFrame: number; toSourceFrame: number; frames: { sheet: number; x: number; y: number }[] };
}
export interface PoseSample { index: number; weight: number }
export function mascotFrames(manifest: MascotManifest): MascotFrame[] {
  const seam = manifest.seam;
  return !seam ? manifest.frames : [...manifest.frames, ...seam.frames.map((frame, index) => ({ ...frame, sourceFrame: seam.fromSourceFrame + (seam.toSourceFrame - seam.fromSourceFrame) * index / (seam.frames.length - 1) }))];
}
export const wrapAngle = (value: number) => ((value % 360) + 360) % 360;
export const angleDelta = (from: number, to: number) => wrapAngle(to - from + 180) - 180;

/** Read adjacent recorded poses, not a looping movie timeline. */
export function samplePose(manifest: MascotManifest, angle: number, neutral: number): PoseSample[] {
  const theta = wrapAngle(angle);
  const mix = Math.max(0, Math.min(1, neutral));
  // A small part of the right-facing arc is an optical-flow morph, not a
  // double exposure. The rest follows the original recorded motion forward.
  const actionAngle = manifest.seam ? Math.max(0, Math.min(360, (theta - 10) * 360 / 340)) : theta;
  const anchors = manifest.anchors;
  const segment = Math.max(0, anchors.findIndex((anchor, i) => i < anchors.length - 1 && actionAngle >= anchor.angle && actionAngle <= anchors[i + 1].angle));
  const a = anchors[segment], b = anchors[segment + 1];
  const source = a.sourceFrame + (b.sourceFrame - a.sourceFrame) * (actionAngle - a.angle) / (b.angle - a.angle);
  const weights = new Map<number, number>();
  const add = (index: number, weight: number) => {
    if (weight > .0001) weights.set(index, (weights.get(index) ?? 0) + weight);
  };
  const pair = (sourceFrame: number, weight: number) => {
    const ordered = manifest.frames.map((frame, index) => ({ ...frame, index })).filter(frame => frame.index !== manifest.neutralIndex);
    const hi = ordered.findIndex(frame => frame.sourceFrame >= sourceFrame);
    if (hi <= 0) { add((hi === 0 ? ordered[0] : ordered[ordered.length - 1]).index, weight); return; }
    const lo = ordered[hi - 1], upper = ordered[hi];
    const ratio = (sourceFrame - lo.sourceFrame) / (upper.sourceFrame - lo.sourceFrame);
    add(lo.index, weight * (1 - ratio)); add(upper.index, weight * ratio);
  };
  // The two right-facing poses inside the clip are close, but not identical.
  // Feather their boundary rather than jumping from the last movie frame to first.
  if (manifest.seam && (theta < 10 || theta > 350)) {
    const position = (theta > 350 ? theta - 350 : theta + 10) / 20 * (manifest.seam.frames.length - 1);
    const index = Math.floor(position), fraction = position - index;
    add(manifest.frames.length + index, (1 - mix) * (1 - fraction));
    add(manifest.frames.length + Math.min(index + 1, manifest.seam.frames.length - 1), (1 - mix) * fraction);
  } else if (manifest.seam) pair(source, 1 - mix);
  else {
    const seamDistance = Math.min(theta, 360 - theta);
    const seamMix = seamDistance < 10 ? .5 * (1 - seamDistance / 10) : 0;
    pair(source, (1 - mix) * (1 - seamMix));
    if (seamMix) pair(theta < 180 ? anchors[anchors.length - 1].sourceFrame : anchors[0].sourceFrame, (1 - mix) * seamMix);
  }
  add(manifest.seam && manifest.idleSeamIndex !== undefined ? manifest.frames.length + manifest.idleSeamIndex : manifest.neutralIndex, mix);
  return [...weights].map(([index, weight]) => ({ index, weight }));
}

export function validateMascotManifest(value: unknown): MascotManifest {
  const data = value as MascotManifest;
  if (!data || data.version !== 1 || !Number.isInteger(data.width) || data.width < 1 || data.width > 1024 ||
      !Number.isInteger(data.height) || data.height < 1 || data.height > 1024 ||
      !Array.isArray(data.sheets) || !data.sheets.length || data.sheets.length > 12 ||
      !Array.isArray(data.frames) || data.frames.length < 3 || data.frames.length > 160 ||
      !Number.isInteger(data.neutralIndex) || !data.frames[data.neutralIndex] ||
      !Array.isArray(data.anchors) || data.anchors.length < 3) throw new Error("Invalid mascot assets");
  if (data.sheets.some(sheet => !/^(?:atlas|poses|seam)-[\w-]+\.webp$/.test(sheet.file) || !Number.isInteger(sheet.width) || !Number.isInteger(sheet.height) || sheet.width < 1 || sheet.height < 1 || sheet.width > 4096 || sheet.height > 4096)) throw new Error("Invalid mascot sheet");
  const sourceFrames = data.frames.filter((_, i) => i !== data.neutralIndex).map(frame => frame.sourceFrame);
  if (sourceFrames.some((frame, i) => !Number.isInteger(frame) || (i > 0 && frame <= sourceFrames[i - 1]))) throw new Error("Unordered mascot frames");
  if (data.seam && (!Array.isArray(data.seam.frames) || data.seam.frames.length < 3 || data.seam.frames.length > 32 || !sourceFrames.includes(data.seam.fromSourceFrame) || !sourceFrames.includes(data.seam.toSourceFrame))) throw new Error("Invalid mascot seam");
  if (data.idleSeamIndex !== undefined && (!Number.isInteger(data.idleSeamIndex) || !data.seam?.frames[data.idleSeamIndex])) throw new Error("Invalid mascot idle pose");
  for (const frame of mascotFrames(data)) {
    const sheet = data.sheets[frame.sheet];
    if (!Number.isInteger(frame.sheet) || !sheet || !Number.isFinite(frame.sourceFrame) || !Number.isInteger(frame.x) || !Number.isInteger(frame.y) || frame.x < 0 || frame.y < 0 || frame.x + data.width > sheet.width || frame.y + data.height > sheet.height) throw new Error("Invalid mascot frame");
  }
  if (data.anchors[0].angle !== 0 || data.anchors[data.anchors.length - 1].angle !== 360 || data.anchors.some((anchor, i) => !Number.isFinite(anchor.angle) || !sourceFrames.includes(anchor.sourceFrame) || (i > 0 && anchor.angle <= data.anchors[i - 1].angle))) throw new Error("Invalid mascot pose anchors");
  return data;
}
