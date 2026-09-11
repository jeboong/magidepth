import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'magimagic-update-')));
after(async () => { if (!path.basename(temp).startsWith('magimagic-update-')) throw new Error('Unsafe test cleanup'); await fs.rm(temp, { recursive: true, force: true }); });
await build({ entryPoints: ['electron/update-manager.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(temp, 'updates.cjs') });
const { UpdateManager } = createRequire(import.meta.url)(path.join(temp, 'updates.cjs'));
const settle = () => new Promise(resolve => setImmediate(resolve));
class FakeUpdater extends EventEmitter {
  autoDownload = true; autoInstallOnAppQuit = true; checks = 0; downloads = 0; installs = 0;
  async checkForUpdates() { this.checks++; this.emit('checking-for-update'); this.emit('update-available', { version: '9.9.9' }); }
  async downloadUpdate() { this.downloads++; this.emit('download-progress', { percent: 45.3 }); this.emit('update-downloaded', { version: '9.9.9' }); }
  quitAndInstall(silent, runAfter) { assert.equal(silent, false); assert.equal(runAfter, true); this.installs++; }
}
function fixture({ auto = false, packaged = true } = {}) {
  const updater = new FakeUpdater(); const events = []; let busy = false; let beforeInstall = 0;
  const manager = new UpdateManager({ updater, packaged, autoDownload: () => auto, busy: () => busy, notify: status => events.push(status), beforeInstall: () => beforeInstall++ });
  return { manager, updater, events, setBusy: value => { busy = value; }, beforeInstall: () => beforeInstall };
}
test('manual-download preference never disables metadata checking or new-version notification', async () => {
  const { manager, updater, events } = fixture(); await manager.check(); await settle();
  assert.equal(updater.checks, 1); assert.equal(updater.downloads, 0); assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(manager.getStatus().status, 'available'); assert.equal(events.at(-1).version, '9.9.9');
});
test('automatic download prepares update but never quits or installs automatically', async () => {
  const { manager, updater } = fixture({ auto: true }); await manager.check(); await settle();
  assert.equal(updater.downloads, 1); assert.equal(manager.getStatus().status, 'ready'); assert.equal(updater.installs, 0);
});
test('explicit download retains version through progress and provides late-subscriber snapshot', async () => {
  const { manager, updater, events } = fixture(); await manager.check(); await manager.download();
  const progress = events.find(event => event.status === 'downloading' && event.percent > 0); assert.equal(progress.version, '9.9.9');
  assert.deepEqual(manager.getStatus(), { status: 'ready', version: '9.9.9', percent: 100 });
  const copy = manager.getStatus(); copy.status = 'error'; assert.equal(manager.getStatus().status, 'ready'); assert.equal(updater.installs, 0);
});
test('install needs ready download and refuses active render/runtime/model/proxy work', async () => {
  const f = fixture(); assert.throws(() => f.manager.install(), /완료/);
  await f.manager.check(); await f.manager.download(); f.setBusy(true); assert.throws(() => f.manager.install(), /작업/);
  assert.equal(f.updater.installs, 0); assert.equal(f.beforeInstall(), 0); f.setBusy(false); f.manager.install(); assert.equal(f.updater.installs, 1); assert.equal(f.beforeInstall(), 1);
});
test('concurrent check/download clicks reuse one operation', async () => {
  const { manager, updater } = fixture(); await Promise.all([manager.check(), manager.check()]);
  assert.equal(updater.checks, 1); await Promise.all([manager.download(), manager.download()]); assert.equal(updater.downloads, 1);
});
test('synchronous check failure does not pin the retry promise', async () => {
  const { manager, updater } = fixture(); updater.checkForUpdates = () => { throw new Error('offline'); };
  await manager.check(); assert.equal(manager.getStatus().status, 'error');
  updater.checkForUpdates = FakeUpdater.prototype.checkForUpdates; await manager.check(); assert.equal(manager.getStatus().status, 'available');
});
test('failed download can retry and retains the discovered version', async () => {
  const { manager, updater } = fixture(); await manager.check(); updater.downloadUpdate = () => { throw new Error('download offline'); };
  await assert.rejects(() => manager.download(), /offline/); assert.equal(manager.getStatus().version, '9.9.9');
  updater.downloadUpdate = FakeUpdater.prototype.downloadUpdate; await manager.download(); assert.equal(manager.getStatus().status, 'ready');
});
test('development builds never invoke release feed, download or installation', async () => {
  const { manager, updater } = fixture({ packaged: false, auto: true }); await manager.check();
  assert.equal(updater.checks, 0); assert.equal(manager.getStatus().status, 'up-to-date'); await assert.rejects(() => manager.download()); assert.throws(() => manager.install()); assert.equal(updater.installs, 0);
});
test('startup check is scheduled independently of the automatic-download preference', async () => {
  const source = await fs.readFile('electron/main.ts', 'utf8');
  assert.match(source, /setTimeout\(\(\)=>void checkUpdates\(\),5000\)/); assert.doesNotMatch(source, /if\s*\(prefs\.autoUpdate\)\s*setTimeout/);
  assert.match(source, /handle\('update:get'/); assert.match(source, /handle\('update:download'/);
});
