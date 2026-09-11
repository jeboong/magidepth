// Focused UI-only regression for the expandable MagiMagic header. No media,
// downloads, installs, or installed desktop app access. Start Vite separately.
// Optional: UI_TEST_URL and PLAYWRIGHT_PACKAGE (a bundled package directory).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const packagePath = process.env.PLAYWRIGHT_PACKAGE;
const { chromium } = await import(packagePath
  ? pathToFileURL(resolve(packagePath, 'index.mjs')).href
  : 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:5173';
const output = resolve('.test-output/header');
await mkdir(output, { recursive: true });
const errors = [];
const within = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y;

async function createPage(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ...options });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('depthdesk-demo', JSON.stringify({
    onboardingDone: true, tutorialDone: true, startupWorkspace: 'depth', theme: 'dark',
  })));
  await page.goto(url);
  await page.getByRole('heading', { name: 'MagiDepth', exact: true }).waitFor();
  await page.getByTestId('workspace-face-selector').waitFor();
  return page;
}

async function waitHeight(page, expected) {
  await page.waitForFunction(target => {
    const surface = document.querySelector('[data-testid="header-surface"]');
    return surface && Math.abs(surface.getBoundingClientRect().height - target) < 2;
  }, expected);
}

async function leaveHeader(page) {
  // A real click outside clears pointer/keyboard focus so the bar can fold.
  await page.mouse.click(10, 550);
  await waitHeight(page, 48);
}

async function checkLayout(page, width) {
  const face = await page.getByTestId('workspace-face-selector').boundingBox();
  const brand = await page.locator('.app-header .brand').boundingBox();
  const actions = await page.locator('.app-header .header-right').boundingBox();
  assert.ok(face && brand && actions, 'header controls have visible bounds');
  assert.ok(within(face.x + face.width / 2, width / 2, 20), 'face selector is horizontally centered');
  assert.equal(overlap(face, brand), false, 'selector does not cover branding');
  assert.equal(overlap(face, actions), false, 'selector does not cover actions');
  assert.ok(face.x >= 0 && face.x + face.width <= width, 'selector stays inside viewport');
  for (const side of ['depth', 'cloak']) {
    const bounds = await page.getByTestId(`workspace-${side}-half`).boundingBox();
    assert.ok(bounds.width >= 44 && bounds.height >= 44, 'each half has at least a 44px pointer target');
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    'header does not introduce horizontal page overflow');
}

async function checkIdleFace(page) {
  for (const side of ['depth', 'cloak']) {
    const half = page.getByTestId(`workspace-${side}-half`);
    const tint = await half.locator('.workspace-face-tint').evaluate(element => getComputedStyle(element).opacity);
    assert.equal(Number(tint), 0, 'collapsed face is not covered by a selection tint');
    const borders = await half.locator('.workspace-face-outline').evaluate(element => {
      const style = getComputedStyle(element);
      return [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor];
    });
    assert.ok(borders.every(color => color === 'transparent' || color === 'rgba(0, 0, 0, 0)'),
      'collapsed selection outline is transparent');
  }
}

async function checkExpandedLabels(page) {
  const face = await page.locator('.workspace-face-image').boundingBox();
  for (const side of ['depth', 'cloak']) {
    const label = page.getByTestId(`workspace-${side}-half`).locator('.workspace-face-name');
    assert.ok(within(await label.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize)), 22, .1),
      'expanded workspace title is 22px');
    const bounds = await label.boundingBox();
    assert.equal(overlap(bounds, face), false, 'large title does not overlap the face image');
  }
}

try {
  const page = await createPage();
  const header = page.getByTestId('app-header');
  const depth = page.getByRole('tab', { name: 'MagiDepth', exact: true });
  const cloak = page.getByRole('tab', { name: 'MagiCloak', exact: true });
  await leaveHeader(page);
  const initialHeader = await header.boundingBox();
  const initialHeading = await page.getByRole('heading', { name: 'MagiDepth', exact: true }).boundingBox();
  assert.ok(within(initialHeader.height, 48), 'idle header is a flat 48px strip');
  await checkLayout(page, 1440);
  await checkIdleFace(page);
  for (const removed of ['깊이를 꺼내는 쪽', '격자를 펼치는 쪽', '반쪽을 눌러, 다른 마법으로.']) {
    assert.equal(await header.getByText(removed, { exact: true }).count(), 0,
      'old helper captions and invitation are removed from the top bar');
  }
  const brandBefore = await header.locator('.brand').boundingBox();
  const actionsBefore = await header.locator('.header-right').boundingBox();

  await page.getByTestId('workspace-face-selector').hover();
  await waitHeight(page, 148);
  const expandedHeader = await header.boundingBox();
  const expandedHeading = await page.getByRole('heading', { name: 'MagiDepth', exact: true }).boundingBox();
  assert.ok(within(expandedHeader.height, initialHeader.height), 'expansion leaves header spacer height fixed');
  assert.ok(within(expandedHeading.y, initialHeading.y), 'workspace does not jump while header expands');
  await checkLayout(page, 1440);
  await checkExpandedLabels(page);
  assert.ok(within((await header.locator('.brand').boundingBox()).y, brandBefore.y),
    'brand stays pinned to the compact strip while expanding');
  assert.ok(within((await header.locator('.header-right').boundingBox()).y, actionsBefore.y),
    'action controls stay pinned to the compact strip while expanding');
  await page.screenshot({ path: resolve(output, 'expanded-dark.png') });

  const left = await depth.boundingBox();
  const right = await cloak.boundingBox();
  assert.ok(left.x < right.x, 'Depth is the visible left half and Cloak the right half');
  await cloak.click();
  assert.equal(await cloak.getAttribute('aria-selected'), 'true');
  await page.getByRole('heading', { name: 'MagiCloak', exact: true }).waitFor();
  await depth.click();
  assert.equal(await depth.getAttribute('aria-selected'), 'true');
  await page.getByRole('heading', { name: 'MagiDepth', exact: true }).waitFor();
  await leaveHeader(page);
  await checkIdleFace(page);
  console.log('PASS flat idle header, hover overlay, stable workspace, centered face, left/right switching');

  // A real Tab establishes keyboard modality and exercises :focus-visible
  // instead of pointer focus. The brand precedes the selector in DOM order.
  await page.locator('.app-header .brand').click();
  await page.mouse.move(10, 550);
  await page.keyboard.press('Tab');
  assert.equal(await depth.evaluate(element => element === document.activeElement), true,
    'the active face half is reachable through the keyboard');
  await waitHeight(page, 148);
  await page.keyboard.press('ArrowRight');
  assert.equal(await cloak.getAttribute('aria-selected'), 'true');
  assert.equal(await cloak.evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await depth.getAttribute('aria-selected'), 'true');
  await page.keyboard.press('End');
  assert.equal(await cloak.getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home');
  assert.equal(await depth.getAttribute('aria-selected'), 'true');
  await leaveHeader(page);
  console.log('PASS keyboard focus expands; Arrow keys and Home/End select accessible face tabs');

  await page.setViewportSize({ width: 1040, height: 720 });
  await page.getByTestId('workspace-face-selector').hover();
  await waitHeight(page, 148);
  await checkLayout(page, 1040);
  await checkExpandedLabels(page);
  await page.getByRole('button', { name: '테마 전환', exact: true }).click();
  assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), false);
  await leaveHeader(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByTestId('workspace-face-selector').hover();
  await waitHeight(page, 148);
  const transition = await page.getByTestId('header-surface').evaluate(element => getComputedStyle(element).transitionDuration);
  assert.ok(transition.split(',').every(value => Number.parseFloat(value) <= 0.01),
    'reduced-motion mode removes prolonged header transitions');
  console.log('PASS 1040px compact layout, light theme, reduced-motion transition');
  await page.close();

  const touch = await createPage({ viewport: { width: 1040, height: 720 }, hasTouch: true, isMobile: true });
  assert.equal(await touch.evaluate(() => matchMedia('(hover: none)').matches), true);
  await touch.getByRole('tab', { name: 'MagiCloak', exact: true }).tap();
  await touch.getByRole('heading', { name: 'MagiCloak', exact: true }).waitFor();
  await touch.getByRole('tab', { name: 'MagiDepth', exact: true }).tap();
  assert.equal(await touch.getByRole('tab', { name: 'MagiDepth', exact: true }).getAttribute('aria-selected'), 'true');
  console.log('PASS no-hover/touch input can reach and switch both face halves');
  await touch.close();
  assert.deepEqual(errors, [], 'no browser exceptions');
  console.log(`PASS focused header smoke. Screenshots: ${output}`);
} finally {
  await browser.close();
}
