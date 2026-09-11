// Focused, local UI-only coverage for the video-derived onboarding mascot.
// Start Vite separately. No runtime downloads, GPU jobs, or installed-app access.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const playwright = process.env.PLAYWRIGHT_PACKAGE;
const { chromium } = await import(playwright
  ? pathToFileURL(resolve(playwright, 'index.mjs')).href : 'playwright');
const compiled = await build({ entryPoints: ['shared/contracts.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('module', 'exports', compiled.outputFiles[0].text)(module, module.exports);
const defaults = module.exports.defaultPreferences;
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:5183';
const output = resolve('.test-output/onboarding-mascot');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const errors = [];
const selectedChecks = process.env.UI_TEST_MATCH ? new RegExp(process.env.UI_TEST_MATCH, 'i') : null;
let checks = 0;
const half = (page, side) => page.getByTestId(`onboarding-${side}-half`);
const mascot = page => page.getByTestId('onboarding-mascot');
const state = page => mascot(page).evaluate(element => ({
  state: element.dataset.state,
  frame: Number(element.dataset.frame),
  min: Number(element.dataset.frameMin),
  max: Number(element.dataset.frameMax),
  reduced: element.dataset.reducedMotion,
}));
async function fixture({ ready = false, cloakReady = false, reducedMotion = 'no-preference',
  theme = 'dark', width = 1440, height = 1000, failAssets = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion });
  page.on('pageerror', error => errors.push(error.message));
  if (failAssets) await page.route('**/brand/onboarding-mascot/**', route => route.abort());
  await page.addInitScript(({ defaults, ready, cloakReady, theme }) => {
    let prefs = { ...defaults, onboardingDone: false, tutorialDone: false, theme };
    let runtime = { ready, cloakReady, installing: false, progress: ready || cloakReady ? 1 : 0,
      message: 'UI test only — no real installs' };
    const callbacks = new Set();
    const mock = { calls: [], installs: [], prefs: () => prefs, runtime: () => runtime, finish: null,
      emit: update => { runtime = { ...runtime, ...update }; for (const callback of callbacks) callback({ ...runtime }); } };
    window.__onboardingMock = mock;
    window.depthdesk = {
      getPreferences: async () => prefs,
      setPreferences: async update => { prefs = { ...prefs, ...update }; mock.calls.push('preferences'); return prefs; },
      getRuntime: async () => runtime,
      onRuntime: callback => { callbacks.add(callback); return () => callbacks.delete(callback); },
      installRuntime: scope => {
        mock.installs.push(scope);
        mock.emit({ installing: true, error: undefined, progress: .02, message: '필요한 구성 확인 중' });
        return new Promise(resolve => { mock.finish = success => {
          mock.emit(success ? { ready: scope === 'depth' || runtime.ready, cloakReady: true,
            installing: false, progress: 1, error: undefined, message: '검증 완료' }
            : { installing: false, error: '테스트 연결 오류', message: '다시 시도할 수 있습니다.' });
          resolve(runtime);
        }; });
      },
      getSystem: async () => ({ cuda: false, gpu: 'TEST', vramGB: 0, freeVramGB: 0,
        torch: 'TEST', python: '3.13', ffmpeg: true }),
      onProgress: () => () => {}, onUpdate: () => () => {}, onCloakProgress: () => () => {},
      chooseVideo: async () => { mock.calls.push('choose'); return null; },
      chooseCloakFiles: async () => { mock.calls.push('cloak-choose'); return []; },
      pasteClipboardImage: async () => { mock.calls.push('paste'); return null; },
      getFilePath: () => '', checkForUpdates: async () => {}, installUpdate: async () => {},
    };
  }, { defaults, ready, cloakReady, theme });
  await page.goto(url);
  await page.getByTestId('onboarding-welcome-next').waitFor();
  return page;
}
async function loaded(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid="onboarding-mascot"]')?.dataset.state === 'ready',
    null, { timeout: 30000 });
}
async function chooseStep(page) {
  await page.getByTestId('onboarding-welcome-next').click();
  await half(page, 'depth').waitFor();
}
async function alphaStats(page) {
  return mascot(page).evaluate(element => {
    const canvas = element instanceof HTMLCanvasElement ? element : element.querySelector('canvas');
    if (!canvas) throw new Error('Ready mascot must render a local alpha canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let clear = 0, visible = 0, fractional = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] === 0) clear++;
      if (pixels[i] > 220) visible++;
      if (pixels[i] > 0 && pixels[i] < 255) fractional++;
    }
    const total = canvas.width * canvas.height;
    const corners = [3, (canvas.width - 1) * 4 + 3,
      (total - canvas.width) * 4 + 3, total * 4 - 1].map(index => pixels[index]);
    return { clear: clear / total, visible: visible / total, fractional, corners };
  });
}
async function check(name, run) {
  if (selectedChecks && !selectedChecks.test(name)) return;
  await run(); checks++; console.log(`PASS ${name}`);
}
try {
  await check('large centered welcome mascot preserves alpha and pointer frames clamp without looping', async () => {
    const page = await fixture(); await loaded(page);
    const modal = await page.locator('.onboarding-modal').boundingBox();
    const bounds = await mascot(page).boundingBox();
    assert.ok(bounds.width >= 300 && bounds.height >= 260, 'welcome mascot is prominent');
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - (modal.x + modal.width / 2)) < 20,
      'welcome mascot is centered in its dialog');
    const alpha = await alphaStats(page);
    assert.ok(alpha.clear > .1 && alpha.visible > .05, 'both transparent background and solid face survive');
    assert.ok(alpha.corners.every(value => value === 0), 'alpha corners do not become black video backing');
    assert.ok(alpha.fractional > 0, 'soft alpha edges survive compositing');
    const frames = [];
    for (const x of [1, 300, 720, 1140, 1439]) {
      await page.mouse.move(x, 420);
      await page.waitForTimeout(320);
      const current = await state(page);
      assert.ok(Number.isFinite(current.frame) && Number.isFinite(current.min) && Number.isFinite(current.max));
      assert.ok(current.frame >= current.min && current.frame <= current.max, 'pose stays within the safe source range');
      frames.push(current.frame);
    }
    assert.ok(new Set(frames).size > 1, 'mouse position selects different genuine head poses');
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointermove',
      { clientX: 10000, clientY: 420, bubbles: true })));
    await page.waitForTimeout(500);
    const edge = await state(page);
    assert.ok(edge.frame >= edge.min && edge.frame <= edge.max);
    await page.waitForTimeout(700);
    assert.ok(Math.abs((await state(page)).frame - edge.frame) < .5,
      'stationary edge pointer settles in place and never wraps end to beginning');
    await page.screenshot({ path: resolve(output, 'welcome-alpha.png') });
    await page.close();
  });

  await check('welcome-to-choice shrinks mascot; both overlays and keyboard selection survive; header stays static', async () => {
    const page = await fixture({ theme: 'light' }); await loaded(page);
    const header = page.getByTestId('workspace-face-selector');
    const imageBefore = await header.locator('.workspace-face-image').getAttribute('src');
    assert.match(imageBefore, /brand\/magidepth\.png$/);
    const before = await mascot(page).boundingBox();
    await page.keyboard.press('Control+o'); await page.keyboard.press('Control+v');
    assert.deepEqual(await page.evaluate(() => window.__onboardingMock.calls), []);
    assert.equal(await page.locator('.app-shell').evaluate(element => element.inert), true);
    await chooseStep(page); await loaded(page); await page.waitForTimeout(450);
    const after = await mascot(page).boundingBox();
    assert.ok(after.height < before.height, 'selection phase makes room for controls');
    assert.equal(await page.getByTestId('onboarding-next').isDisabled(), true);
    for (const side of ['depth', 'cloak']) {
      await half(page, side).hover();
      await half(page, side).click();
      assert.equal(await half(page, side).getAttribute('aria-checked'), 'true');
      const frame = await half(page, side).locator('.onboarding-half-frame').evaluate(element => {
        const style = getComputedStyle(element); return [style.borderTopColor, style.borderTopWidth];
      });
      assert.notEqual(frame[0], 'rgba(0, 0, 0, 0)', 'selected half has a visible UI outline');
      assert.ok(parseFloat(frame[1]) >= 1);
    }
    await half(page, 'depth').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await half(page, 'cloak').getAttribute('aria-checked'), 'true');
    assert.equal(await half(page, 'cloak').evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Home'); assert.equal(await half(page, 'depth').getAttribute('aria-checked'), 'true');
    assert.equal(await header.locator('.workspace-face-image').getAttribute('src'), imageBefore);
    assert.equal(await header.locator('canvas,video').count(), 0, 'animated mascot is confined to onboarding');
    await page.screenshot({ path: resolve(output, 'selection-overlay-light.png') });
    await page.close();
  });

  await check('setup back, retry, progress and browse preserve the existing runtime contract', async () => {
    const page = await fixture(); await chooseStep(page);
    await half(page, 'depth').click(); await page.getByTestId('onboarding-next').click();
    await page.getByText('MagiMagic 사용을 위해 최초 1회 셋업이 필요합니다. 인터넷 환경과 PC 성능에 따라 수십 분 이상 소요될 수 있습니다.', { exact: true }).waitFor();
    await page.getByRole('button', { name: '다른 기능 선택', exact: true }).click();
    assert.equal(await half(page, 'depth').getAttribute('aria-checked'), 'true');
    await half(page, 'cloak').click(); await page.getByTestId('onboarding-next').click();
    await page.getByText('PyTorch/CUDA는 설치하지 않습니다.', { exact: false }).waitFor();
    await page.getByRole('button', { name: '셋업 시작', exact: true }).click();
    await page.evaluate(() => window.__onboardingMock.finish(false));
    await page.locator('.onboarding-modal').getByText('테스트 연결 오류', { exact: true }).waitFor();
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
    await page.evaluate(() => window.__onboardingMock.emit({ progress: .42, message: 'OpenCV 구성 요소 준비 중' }));
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '42');
    assert.deepEqual(await page.evaluate(() => window.__onboardingMock.installs), ['cloak', 'cloak']);
    await page.getByRole('button', { name: '설치 중 작업실 둘러보기', exact: true }).click();
    await page.locator('.onboarding-modal').waitFor({ state: 'hidden' });
    const result = await page.evaluate(() => ({ prefs: window.__onboardingMock.prefs(), runtime: window.__onboardingMock.runtime() }));
    assert.equal(result.runtime.installing, true); assert.equal(result.prefs.startupWorkspace, 'cloak');
    assert.equal(result.prefs.onboardingDone, true); assert.equal(result.prefs.tutorialDone, false);
    await page.evaluate(() => window.__onboardingMock.finish(true));
    await page.close();
  });

  await check('already-installed module skips downloads and reopens welcome with remembered selection', async () => {
    const page = await fixture({ ready: true, cloakReady: true }); await chooseStep(page);
    await half(page, 'cloak').click(); await page.getByTestId('onboarding-next').click();
    await page.locator('.onboarding-modal').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.__onboardingMock.installs), []);
    assert.equal(await page.getByRole('tab', { name: 'MagiCloak', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: '앱 설정', exact: true }).click();
    await page.getByRole('button', { name: 'MagiMagic 기능 다시 선택', exact: true }).click();
    await page.getByTestId('onboarding-welcome-next').waitFor(); await chooseStep(page);
    assert.equal(await half(page, 'cloak').getAttribute('aria-checked'), 'true');
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.getByRole('button', { name: '기능 선택 닫기', exact: true }).click();
    await page.locator('.onboarding-modal').waitFor({ state: 'hidden' });
    await page.close();
  });

  await check('reduced motion freezes the neutral frame but preserves usable compact light-theme controls', async () => {
    const page = await fixture({ ready: true, cloakReady: true, reducedMotion: 'reduce',
      theme: 'light', width: 1040, height: 720 }); await loaded(page);
    const first = await state(page); assert.equal(first.reduced, 'true');
    await page.mouse.move(1, 250); await page.waitForTimeout(350);
    await page.mouse.move(1039, 250); await page.waitForTimeout(350);
    assert.equal((await state(page)).frame, first.frame, 'reduced-motion users do not receive tracking animation');
    const bounds = await page.locator('.onboarding-modal').boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 720, 'dialog remains within compact viewport');
    assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), false);
    await chooseStep(page); await half(page, 'depth').focus(); await page.keyboard.press('End');
    assert.equal(await half(page, 'cloak').getAttribute('aria-checked'), 'true');
    await page.getByTestId('onboarding-next').click();
    await page.locator('.onboarding-modal').waitFor({ state: 'hidden' });
    await page.close();
  });

  await check('asset failure retains a visible mascot fallback and allows selection without blocking startup', async () => {
    const page = await fixture({ ready: true, cloakReady: true, failAssets: true });
    await page.waitForFunction(() => document.querySelector('[data-testid="onboarding-mascot"]')?.dataset.state === 'fallback');
    await mascot(page).locator('img').evaluate(image => image.decode());
    const hasFallback = await mascot(page).evaluate(element => {
      const image = element.querySelector('img');
      return !!image && image.complete && image.naturalWidth > 0;
    });
    assert.equal(hasFallback, true, 'a local image is still visible if optional animation assets fail');
    await chooseStep(page); await half(page, 'depth').click(); await page.getByTestId('onboarding-next').click();
    await page.locator('.onboarding-modal').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('tab', { name: 'MagiDepth', exact: true }).getAttribute('aria-selected'), 'true');
    await page.close();
  });
  await check('right-direction pose seam crosses without a visible first-to-last-frame pop', async () => {
    const page = await fixture(); await loaded(page);
    const bounds = await mascot(page).boundingBox();
    const x = Math.min(1439, bounds.x + bounds.width * 2);
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y - 1); await page.waitForTimeout(650);
    await mascot(page).evaluate(element => {
      const canvas = element.querySelector('canvas');
      window.__mascotSeamPixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    });
    await page.mouse.move(x, y + 1); await page.waitForTimeout(650);
    const meanDifference = await mascot(page).evaluate(element => {
      const canvas = element.querySelector('canvas');
      const next = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const previous = window.__mascotSeamPixels;
      let difference = 0;
      for (let i = 0; i < next.length; i++) difference += Math.abs(next[i] - previous[i]);
      return difference / next.length;
    });
    assert.ok(meanDifference < 3, `two-pixel seam crossing stays visually continuous (mean channel delta ${meanDifference})`);
    await page.close();
  });
  assert.deepEqual(errors, [], 'no uncaught browser exceptions');
  console.log(`PASS ${checks} focused onboarding mascot scenarios. Screenshots: ${output}`);
} finally { await browser.close(); }
