import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const compiled = await build({ entryPoints: ['src/components/mascotPose.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = { exports: {} };
new Function('module', 'exports', compiled.outputFiles[0].text)(mod, mod.exports);
const { samplePose, validateMascotManifest, angleDelta, mascotFrames } = mod.exports;
const frames = [16, ...Array.from({ length: 49 }, (_, i) => 24 + i * 2)].map((sourceFrame, index) => ({ sourceFrame, sheet: Math.floor(index / 16), x: index % 4 * 512, y: Math.floor(index % 16 / 4) * 464 }));
const manifest = {
  version: 1, width: 512, height: 464, neutralIndex: 0,
  sheets: Array.from({ length: 4 }, (_, i) => ({ file: `atlas-${i}.webp`, width: 2048, height: 1856 })),
  frames,
  anchors: [24, 40, 56, 72, 88, 96, 104, 112, 120].map((sourceFrame, i) => ({ angle: i * 45, sourceFrame })),
};
test('mascot poses have normalized weights and never use the original video endpoints', () => {
  validateMascotManifest(manifest);
  for (let angle = -720; angle <= 720; angle += 3) {
    for (const neutral of [0, .3, 1]) {
      const samples = samplePose(manifest, angle, neutral);
      assert.ok(Math.abs(samples.reduce((sum, sample) => sum + sample.weight, 0) - 1) < .0003);
      assert.ok(samples.every(sample => sample.weight > 0 && frames[sample.index].sourceFrame >= 16 && frames[sample.index].sourceFrame <= 120));
    }
  }
});
test('right-facing seam is feathered continuously, not last-to-first playback', () => {
  const weights = angle => new Map(samplePose(manifest, angle, 0).map(sample => [sample.index, sample.weight]));
  const left = weights(359.999), right = weights(.001);
  const difference = [...new Set([...left.keys(), ...right.keys()])].reduce((sum, index) => sum + Math.abs((left.get(index) ?? 0) - (right.get(index) ?? 0)), 0);
  assert.ok(difference < .002, `seam weight discontinuity ${difference}`);
  assert.equal(angleDelta(359, 1), 2);
  assert.equal(angleDelta(1, 359), -2);
});
test('neutral holds a single recorded pose', () => {
  assert.deepEqual(samplePose(manifest, 220, 1), [{ index: 0, weight: 1 }]);
});
test('mascot manifest rejects traversal, malformed atlas bounds and missing pose anchors', () => {
  const invalid = patch => ({ ...manifest, ...patch });
  assert.throws(() => validateMascotManifest(invalid({ sheets: [{ ...manifest.sheets[0], file: '../other.webp' }] })));
  assert.throws(() => validateMascotManifest(invalid({ frames: [{ ...frames[0], x: 99999 }, ...frames.slice(1)] })));
  assert.throws(() => validateMascotManifest(invalid({ anchors: manifest.anchors.slice(1) })));
  assert.throws(() => validateMascotManifest(invalid({ frames: [frames[0], frames[2], frames[1], ...frames.slice(3)] })));
});
test('shipping flow seam and idle pose share an aligned frame without a neutral-return jump', async () => {
  const shipped = validateMascotManifest(JSON.parse(await readFile('public/brand/onboarding-mascot/manifest.json', 'utf8')));
  assert.equal(shipped.idleSeamIndex, 6);
  assert.deepEqual(samplePose(shipped, 0, 0), samplePose(shipped, 120, 1));
  const allFrames = mascotFrames(shipped);
  for (let angle = 0; angle <= 360; angle += .7) {
    const samples = samplePose(shipped, angle, 0);
    assert.ok(Math.abs(samples.reduce((sum, sample) => sum + sample.weight, 0) - 1) < .0003);
    assert.ok(samples.every(sample => allFrames[sample.index]));
  }
  const distances = [0, 10, 350].map(boundary => {
    const before = new Map(samplePose(shipped, boundary - .0001, 0).map(sample => [sample.index, sample.weight]));
    const after = new Map(samplePose(shipped, boundary + .0001, 0).map(sample => [sample.index, sample.weight]));
    // Endpoint references may use different indices but point at identical atlas pixels.
    const rectWeights = samples => [...samples].reduce((result, [index, weight]) => {
      const frame = allFrames[index], key = `${frame.sheet}/${frame.x}/${frame.y}`;
      result.set(key, (result.get(key) ?? 0) + weight); return result;
    }, new Map());
    const a = rectWeights(before), b = rectWeights(after);
    return [...new Set([...a.keys(), ...b.keys()])].reduce((sum, key) => sum + Math.abs((a.get(key) ?? 0) - (b.get(key) ?? 0)), 0);
  });
  assert.ok(distances.every(distance => distance < .002));
});
