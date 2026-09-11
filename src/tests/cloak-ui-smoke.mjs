// Explicit API fixture: validates frontend behavior, never claims model accuracy.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_PACKAGE
    ? pathToFileURL(resolve(process.env.PLAYWRIGHT_PACKAGE, "index.mjs")).href
    : "playwright"
);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const svg = (grid = false) =>
    "data:image/svg+xml;base64," +
    btoa(
      `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#263b48"/><stop offset="1" stop-color="#6d7770"/></linearGradient><pattern id="g" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#c4e99b" stroke-width="2"/></pattern></defs><rect width="960" height="540" fill="url(#bg)"/><path d="M260 540Q270 350 400 345H540Q680 350 700 540" fill="#283a39"/><ellipse cx="480" cy="248" rx="101" ry="131" fill="#b2bca3"/><ellipse cx="442" cy="226" rx="10" ry="5" fill="#3d4d43"/><ellipse cx="518" cy="226" rx="10" ry="5" fill="#3d4d43"/><path d="M458 306Q480 318 502 306" stroke="#56644e" stroke-width="5" fill="none"/>${grid ? '<ellipse cx="480" cy="248" rx="101" ry="131" fill="url(#g)"/>' : ""}<text x="30" y="40" fill="#ffffff80" font-family="sans-serif" font-size="12">SYNTHETIC UI TEST FIXTURE</text></svg>`,
    );
  const source = svg(),
    processed = svg(true);
  let prefs = {
    theme: "dark",
    outputDir: "C:/test/depth",
    tutorialDone: true,
    autoUpdate: true,
    options: {
      maps: ["depth"],
      processingMode: "fast",
      previewMap: "depth",
      normalStrength: 1,
      steps: 4,
      model: "image-small",
      inputSize: 280,
      nearWhite: true,
      gamma: 1,
      contrast: 0.5,
      device: "auto",
      precision: "auto",
      outputSize: "source",
      codec: "h264",
    },
    cloakOutputDir: "C:/test/cloak",
    cloakOptions: {
      methods: { A: false, B: false, C: false },
      eps: 6,
      strength: 0.05,
      use_grid: true,
      tracking: true,
      quality: "visually_lossless",
      pad_enabled: false,
      pad_seconds: 4,
      pad_position: "after",
      roi_shape: "ellipse",
      detect_score: 0.6,
      man_cx: 0.5,
      man_cy: 0.5,
      man_w: 0.35,
      man_h: 0.45,
      grid: {
        rows: 6,
        cols: 6,
        thickness: 2,
        auto_thickness: true,
        color: [255, 255, 255],
        opacity: 0.6,
        margin: 0.06,
        shape: "ellipse",
        align_angle: true,
        dots: false,
        dot_radius: 3,
        line_aa: true,
      },
    },
  };
  const info = (path) => ({
    path,
    kind: path.endsWith(".mp4") ? "video" : "image",
    name: path.split("/").pop(),
    width: 960,
    height: 540,
    fps: path.endsWith(".mp4") ? 30 : 1,
    frames: path.endsWith(".mp4") ? 150 : 1,
    duration: path.endsWith(".mp4") ? 5 : 1,
    hasAudio: path.endsWith(".mp4"),
    thumbnail: source,
  });
  const state = (window.__cloakTest = {
    calls: [],
    renders: [],
    cancelled: [],
    paste: 0,
    progress: null,
  });
  let runtime = {
    ready: true,
    cloakReady: true,
    installing: false,
    progress: 1,
    message: "EXPLICIT UI FIXTURE",
    mediaTools: {
      ffmpeg: "C:/test/ffmpeg.exe",
      ffprobe: "C:/test/ffprobe.exe",
      version: "test-8",
      probeVersion: "test-8",
      source: "cache",
    },
  };
  window.depthdesk = {
    getPreferences: async () => prefs,
    setPreferences: async (p) => (prefs = { ...prefs, ...p }),
    getRuntime: async () => runtime,
    installRuntime: async () => runtime,
    getSystem: async () => ({
      cuda: false,
      gpu: "UI fixture",
      vramGB: 0,
      freeVramGB: 0,
      torch: "test",
      python: "test",
      ffmpeg: true,
      appVersion: "0.2.0",
    }),
    onRuntime: () => () => {},
    onUpdate: () => () => {},
    onProgress: () => () => {},
    checkForUpdates: async () => {},
    installUpdate: async () => {},
    getFilePath: (f) => "C:/test/" + f.name,
    pasteClipboardImage: async () => {
      state.paste++;
      return "C:/test/pasted.png";
    },
    chooseVideo: async () => source,
    probeVideo: async (path) => ({
      ...info(path),
      kind: "image",
      name: "depth-preserved.png",
    }),
    preview: async () => ({
      source,
      image: processed,
      frame: 0,
      width: 960,
      height: 540,
      elapsed: 0.1,
    }),
    render: async () => ({
      outputPath: "test.png",
      frames: 1,
      elapsed: 0.1,
      fps: 0,
    }),
    cancelJob: async () => {},
    chooseOutputDir: async () => null,
    chooseSavePath: async () => null,
    openFolder: async (p) => (state.open = p),
    revealFile: async (p) => (state.reveal = p),
    chooseCloakFiles: async () => ["C:/test/portrait.mp4", "C:/test/still.png"],
    cloakProbe: async (path) => info(path),
    cloakPreview: async (request) => {
      state.calls.push(request);
      await new Promise((r) => setTimeout(r, 75));
      return {
        source,
        image: processed,
        elapsed: 0.075,
        frame: request.findFace ? 30 : Math.round(request.time * 30),
        width: 960,
        height: 540,
        faceCount: 1,
        detector: "YuNet (fixture)",
      };
    },
    cancelCloakJob: async (id) => state.cancelled.push(id),
    chooseCloakOutputDir: async () => "C:/test/chosen",
    chooseCloakSavePath: async (path) => {
      state.saveAs = path;
      return state.saveAsOverride ?? "C:/test/chosen/renamed.png";
    },
    onCloakProgress: (cb) => {
      state.progress = cb;
      return () => {};
    },
    cloakRender: async (request) => {
      state.renders.push(request);
      for (let i = 0; i < (state.cancelMode ? 20 : 3); i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (state.cancelled.includes(request.jobId))
          throw new Error("cancelled");
        state.progress?.({
          jobId: request.jobId,
          stage: "render",
          progress: (i + 1) / 3,
          message: "Fixture render",
          fileIndex: 0,
          totalFiles: request.jobs.length,
          frame: i + 1,
          totalFrames: 3,
          outputPath:
            state.cancelMode && i === 0
              ? request.jobs[0].outputPath
              : undefined,
        });
      }
      return {
        outputs: request.jobs.map((j) => j.outputPath),
        frames: 150,
        elapsed: 0.3,
        fps: 500,
      };
    },
  };
});
await page.goto(process.env.UI_TEST_URL ?? "http://127.0.0.1:5173");
await page.getByRole("button", { name: "파일 선택", exact: true }).click();
await page.getByText("depth-preserved.png", { exact: true }).waitFor();
await page.getByRole("tab", { name: "MagiCloak", exact: true }).click();
await page
  .getByRole("heading", { name: "매지코의 마법을 느껴보세요" })
  .waitFor();
await page.waitForTimeout(350);
assert.equal(
  await page
    .getByRole("heading", { name: "MagiCloak", exact: true })
    .isVisible(),
  true,
);
assert.equal(
  await page
    .getByRole("button", { name: "A Face Grid 얼굴 격자", exact: true })
    .getAttribute("aria-pressed"),
  "true",
);
assert.equal(
  await page
    .getByText("이 기능은 실험적 기능이며, 적용효과가 없을 수 있습니다.", {
      exact: true,
    })
    .count(),
  0,
);
await mkdir("src/tests/artifacts", { recursive: true });
await page.screenshot({ path: "src/tests/artifacts/cloak-empty-dark.png" });
await page.getByRole("button", { name: "파일 추가", exact: true }).click();
await page.getByAltText("Cloak 처리 결과", { exact: true }).waitFor();
await page.waitForTimeout(250);
assert.equal(
  await page.evaluate(() => window.__cloakTest.calls[0].findFace),
  true,
);
assert.equal(
  await page.getByRole("spinbutton", { name: "행", exact: true }).inputValue(),
  "6",
);
await page.getByRole("spinbutton", { name: "행", exact: true }).fill("9");
await page.waitForTimeout(450);
assert.equal(
  await page.evaluate(() => window.__cloakTest.calls.at(-1).options.grid.rows),
  9,
);
await page
  .getByRole("button", { name: "B Cloak 미세 노이즈", exact: true })
  .click();
await page
  .getByText("이 기능은 실험적 기능이며, 적용효과가 없을 수 있습니다.", {
    exact: true,
  })
  .waitFor();
for (const [label, key] of [
  ["C Frequency 주파수 변형", "B"],
  ["D Semantic 그레인·워프", "C"],
]) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(
      (key) => window.__cloakTest.calls.at(-1).options.methods[key],
      key,
    ),
    true,
  );
  await page.getByRole("button", { name: label, exact: true }).click();
}
await page
  .getByRole("spinbutton", { name: "B · 노이즈 강도", exact: true })
  .fill("12");
await page
  .getByRole("switch", { name: "자동 얼굴 검출 · 추적", exact: true })
  .click();
await page.locator('input[aria-label="격자 색상"]').fill("#ff0033");
await page.waitForTimeout(500);
assert.deepEqual(
  await page.evaluate(() => window.__cloakTest.calls.at(-1).options.grid.color),
  [51, 0, 255],
);
assert.equal(
  await page.evaluate(() => window.__cloakTest.calls.at(-1).options.methods.A),
  true,
);
const box = await page
  .getByLabel("Cloak 파일 드롭 및 미리보기 영역", { exact: true })
  .boundingBox();
await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55);
await page.mouse.up();
await page.waitForTimeout(400);
assert.ok(
  Number(
    await page
      .getByRole("spinbutton", { name: "가로 위치", exact: true })
      .inputValue(),
  ) > 0.6,
);
await page.getByRole("button", { name: "비교", exact: true }).click();
await page
  .getByRole("slider", { name: "Cloak 원본 결과 비교 위치", exact: true })
  .fill("60");
await page
  .getByRole("button", { name: "Cloak 다음 프레임", exact: true })
  .click();
await page.waitForTimeout(250);
assert.ok(
  (await page.evaluate(() => window.__cloakTest.calls.at(-1).time)) > 1,
);
await page.getByRole("tab", { name: "MagiDepth", exact: true }).click();
await page.getByText("depth-preserved.png", { exact: true }).waitFor();
await page.getByRole("tab", { name: "MagiCloak", exact: true }).click();
assert.equal(
  await page.getByRole("spinbutton", { name: "행", exact: true }).inputValue(),
  "9",
);
await page
  .getByRole("switch", { name: "짧은 영상 검정 패딩", exact: true })
  .click();
await page
  .getByRole("combobox", { name: "검정 패딩 위치", exact: true })
  .click();
await page
  .getByRole("option", { name: "영상 앞 · Front", exact: true })
  .click();
await page
  .getByRole("spinbutton", { name: "최소 영상 길이", exact: true })
  .fill("8");
await page
  .getByRole("button", { name: "2개 일괄 내보내기", exact: true })
  .click();
await page.getByRole("button", { name: "작업 취소", exact: true }).waitFor();
await page.getByRole("tab", { name: "MagiDepth", exact: true }).click();
assert.equal(
  await page
    .getByRole("button", { name: "1개 맵 이미지 내보내기" })
    .isDisabled(),
  true,
);
await page.getByRole("tab", { name: "MagiCloak", exact: true }).click();
await page
  .getByRole("button", { name: "저장된 결과 보기 · 2개", exact: true })
  .waitFor();
assert.equal(
  await page.evaluate(() => window.__cloakTest.renders.at(-1).jobs.length),
  2,
);
assert.equal(
  await page.evaluate(
    () => window.__cloakTest.renders.at(-1).options.pad_position,
  ),
  "before",
);
assert.equal(
  await page.evaluate(
    () => window.__cloakTest.renders.at(-1).options.pad_seconds,
  ),
  8,
);
await page
  .getByRole("combobox", { name: "검정 패딩 위치", exact: true })
  .click();
await page.getByRole("option", { name: "영상 뒤 · Back", exact: true }).click();
await page.locator(".cloak-settings-scroll").evaluate((e) => (e.scrollTop = 0));
await page
  .getByRole("button", { name: "저장된 결과 보기 · 2개", exact: true })
  .click();
assert.ok(
  await page.evaluate(() =>
    window.__cloakTest.reveal.endsWith("portrait_cloaked.mp4"),
  ),
);
await page
  .getByRole("button", { name: "portrait.mp4 제거", exact: true })
  .click();
await page
  .getByRole("button", { name: "Cloak 다른 이름으로 저장", exact: true })
  .click();
await page
  .getByRole("button", { name: "저장된 결과 보기 · 1개", exact: true })
  .waitFor();
assert.equal(
  await page.evaluate(
    () => window.__cloakTest.renders.at(-1).jobs[0].outputPath,
  ),
  "C:/test/chosen/renamed.png",
);
await page.getByRole("button", { name: "튜토리얼 열기", exact: true }).click();
await page
  .getByRole("heading", { name: "재료는 한 번에, 여러 개도." })
  .waitFor();
for (let i = 0; i < 5; i++)
  await page.getByRole("button", { name: "다음", exact: true }).click();
await page.getByRole("button", { name: "주문 시작", exact: true }).click();
await page.getByRole("button", { name: "앱 설정", exact: true }).click();
await page.getByText("C:/test/ffmpeg.exe", { exact: false }).waitFor();
await page.getByRole("button", { name: "닫기", exact: true }).click();
await page
  .getByLabel("Cloak 파일 드롭 및 미리보기 영역", { exact: true })
  .hover();
await page.keyboard.press("Control+v");
await page
  .getByRole("button", { name: "pasted.png 미리보기", exact: true })
  .waitFor();
assert.equal(await page.evaluate(() => window.__cloakTest.paste), 1);
await page.getByRole("spinbutton", { name: "행", exact: true }).focus();
await page.keyboard.press("Control+v");
assert.equal(await page.evaluate(() => window.__cloakTest.paste), 1);
await page.getByRole("button", { name: "결과", exact: true }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: "src/tests/artifacts/cloak-loaded-dark.png" });
await page.getByRole("button", { name: "테마 전환", exact: true }).click();
await page.waitForTimeout(350);
await page.screenshot({ path: "src/tests/artifacts/cloak-loaded-light.png" });
await page.evaluate(() => {
  window.__cloakTest.cancelMode = true;
});
await page
  .getByRole("button", { name: "2개 일괄 내보내기", exact: true })
  .click();
await page
  .getByRole("button", { name: "저장된 결과 보기 · 1개", exact: true })
  .waitFor();
await page.getByRole("button", { name: "작업 취소", exact: true }).click();
await page
  .getByText("작업이 취소되었습니다. 완료된 파일은 저장 폴더에서 확인하세요.", {
    exact: true,
  })
  .waitFor();
assert.equal(
  await page
    .getByRole("button", { name: "저장된 결과 보기 · 1개", exact: true })
    .isVisible(),
  true,
);
await page.getByRole("tab", { name: "MagiDepth", exact: true }).click();
await page.getByRole("button", { name: "앱 설정", exact: true }).focus();
await page.keyboard.press("Control+v");
assert.equal(await page.evaluate(() => window.__cloakTest.paste), 1);
await page.getByRole("tab", { name: "MagiCloak", exact: true }).click();
await page.setViewportSize({ width: 1100, height: 800 });
await page.waitForTimeout(400);
assert.ok(
  await page
    .getByRole("button", { name: "2개 일괄 내보내기", exact: true })
    .isVisible(),
);
assert.equal(
  await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  ),
  false,
);
await page.screenshot({ path: "src/tests/artifacts/cloak-compact-light.png" });
await page.evaluate(() => {
  window.__cloakTest.cancelMode = false;
});
await page.getByRole("button", { name: "비우기", exact: true }).click();
await page.getByRole("button", { name: "파일 추가", exact: true }).click();
await page.getByRole("button", { name: "still.png 제거", exact: true }).click();
for (const extension of ["mov", "mkv", "m4v"]) {
  await page.evaluate((extension) => {
    window.__cloakTest.saveAsOverride = `C:/test/chosen/movie.${extension}`;
  }, extension);
  await page
    .getByRole("button", { name: "Cloak 다른 이름으로 저장", exact: true })
    .click();
  await page
    .getByRole("button", { name: "작업 취소", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(
      () => window.__cloakTest.renders.at(-1).jobs[0].outputPath,
    ),
    `C:/test/chosen/movie.${extension}`,
  );
  assert.equal(
    await page.evaluate(
      () => window.__cloakTest.renders.at(-1).options.pad_position,
    ),
    "after",
  );
}
assert.deepEqual(errors, []);
console.log(
  "PASS: Cloak upload, auto-first-face, debounced settings, exact BGR conversion, manual grid drag, frame step, comparison, tab state preservation, cross-module busy guard, batch export, Save As, reveal, partial-file retention after cancellation, six-step tutorial, tool provenance, scoped/inactive clipboard, compact layout and themes. Explicit synthetic API fixture only.",
);
await browser.close();
