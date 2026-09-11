import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'magimagic-media-')));
after(async () => { if (!path.basename(temp).startsWith('magimagic-media-')) throw new Error('Unsafe test cleanup'); await fs.rm(temp, { recursive: true, force: true }); });
await build({ entryPoints: ['electron/media-protocol.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(temp, 'protocol.cjs') });
const { parseByteRange, createMediaProtocolHandler } = createRequire(import.meta.url)(path.join(temp, 'protocol.cjs'));
const media = path.join(temp, '테스트 원본.mp4'); const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i)); await fs.writeFile(media, bytes);
const allowed = new Set([media.toLowerCase()]); const handler = createMediaProtocolHandler(allowed);
const request = (file = media, options = {}) => new Request(`depthdesk-media://local/?path=${encodeURIComponent(file)}`, options);
test('closed, open, suffix and oversized-end ranges are parsed safely', () => {
  assert.deepEqual(parseByteRange('bytes=4-7', 16), { start: 4, end: 7 });
  assert.deepEqual(parseByteRange('bytes=4-', 16), { start: 4, end: 15 });
  assert.deepEqual(parseByteRange('bytes=-4', 16), { start: 12, end: 15 });
  assert.deepEqual(parseByteRange('bytes=4-999', 16), { start: 4, end: 15 });
  assert.deepEqual(parseByteRange('bytes=-999', 16), { start: 0, end: 15 });
  for (const value of ['bytes=16-', 'bytes=9-4', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-8', 'bytes=x-y', 'bytes=99999999999999999999-']) assert.equal(parseByteRange(value, 16), 'invalid');
});
test('full response reports byte length, MIME and range capability', async () => {
  const response = await handler(request()); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(response.headers.get('content-length'), '256'); assert.equal(response.headers.get('accept-ranges'), 'bytes'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});
test('range response has206, exact bytes and Content-Range', async () => {
  const response = await handler(request(media, { headers: { Range: 'bytes=20-39' } }));
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 20-39/256'); assert.equal(response.headers.get('content-length'), '20'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(20, 40));
});
test('unsatisfiable range is416 rather than a network failure', async () => {
  const response = await handler(request(media, { headers: { Range: 'bytes=999-' } })); assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */256'); assert.equal((await response.arrayBuffer()).byteLength, 0);
});
test('HEAD does not open a body and unsupported methods are denied', async () => {
  const response = await handler(request(media, { method: 'HEAD' })); assert.equal(response.status, 200); assert.equal(response.headers.get('content-length'), '256'); assert.equal((await response.arrayBuffer()).byteLength, 0);
  assert.equal((await handler(request(media, { method: 'POST' }))).status, 405);
});
test('unregistered, remote, missing and directory sources remain protected', async () => {
  const denied = path.join(temp, 'private.mp4'); await fs.writeFile(denied, bytes);
  assert.equal((await handler(request(denied))).status, 403);
  assert.equal((await handler(new Request('depthdesk-media://elsewhere/?path=' + encodeURIComponent(media)))).status, 403);
  assert.equal((await handler(request(path.join(temp, 'missing.mp4')))).status, 404);
  allowed.add(temp.toLowerCase()); assert.equal((await handler(request(temp))).status, 404);
});
