import {
  defaultPreferences,
  type DepthDeskAPI,
  type Preferences,
  type VideoInfo,
} from "../../shared/contracts";
declare global {
  interface Window {
    depthdesk?: DepthDeskAPI;
  }
}
export const isBrowserDemo = !window.depthdesk;
const urls = new Map<string, string>();
const files = new WeakMap<File, string>();
function remember(file: File) {
  let path = files.get(file);
  if (!path) {
    path = `browser/${file.name}`;
    files.set(file, path);
    const old = urls.get(path);
    if (old) URL.revokeObjectURL(old);
    urls.set(path, URL.createObjectURL(file));
  }
  return path;
}
function readPrefs(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem("depthdesk-demo") ?? "{}");
    return {
      ...defaultPreferences,
      ...stored,
      options: { ...defaultPreferences.options, ...stored.options },
    };
  } catch {
    return structuredClone(defaultPreferences);
  }
}
const demo: DepthDeskAPI = {
  getPreferences: async () => readPrefs(),
  setPreferences: async (prefs) => {
    const next = { ...readPrefs(), ...prefs };
    localStorage.setItem("depthdesk-demo", JSON.stringify(next));
    return next;
  },
  chooseVideo: () =>
    new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,video/*,.mkv,.mov,.webm,.avi";
      input.addEventListener(
        "change",
        () => resolve(input.files?.[0] ? remember(input.files[0]) : null),
        { once: true },
      );
      input.addEventListener("cancel", () => resolve(null), { once: true });
      input.click();
    }),
  getFilePath: remember,
  pasteClipboardImage: async () => {
    try {
      const entries = await navigator.clipboard.read();
      for (const entry of entries) {
        const type = entry.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await entry.getType(type);
          return remember(
            new File([blob], `clipboard-${Date.now()}.png`, { type }),
          );
        }
      }
    } catch {
      throw new Error(
        "브라우저 클립보드 접근 권한이 필요합니다. 이미지 파일을 드래그해 주세요.",
      );
    }
    return null;
  },
  probeVideo: async (path) =>
    new Promise<VideoInfo>((resolve, reject) => {
      if (/\.(png|jpg|jpeg|webp|bmp|gif|tiff?)$/i.test(path)) {
        const img = new Image();
        img.onload = () =>
          resolve({
            kind: "image",
            path,
            name: path.split("/").pop() ?? "image",
            width: img.naturalWidth,
            height: img.naturalHeight,
            duration: 1,
            fps: 1,
            frames: 1,
            hasAudio: false,
          });
        img.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
        img.src = urls.get(path) ?? "";
        return;
      }
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        resolve({
          kind: "video",
          path,
          name: path.split("/").pop() ?? "video",
          width: v.videoWidth,
          height: v.videoHeight,
          duration: v.duration,
          fps: 30,
          frames: Math.round(v.duration * 30),
          hasAudio: false,
        });
        v.removeAttribute("src");
        v.load();
      };
      v.onerror = () =>
        reject(
          new Error(
            "이 브라우저에서 재생할 수 없는 영상입니다. 데스크톱 앱에서 열어 주세요.",
          ),
        );
      v.src = urls.get(path) ?? "";
    }),
  preview: async () => {
    throw new Error(
      "실제 AI 프레임 렌더는 설치된 데스크톱 앱에서 이용할 수 있습니다.",
    );
  },
  render: async () => {
    throw new Error(
      "실제 뎁스 영상 렌더는 설치된 데스크톱 앱에서 이용할 수 있습니다.",
    );
  },
  cancelJob: async () => {},
  chooseOutputDir: async () => null,
  chooseSavePath: async () => null,
  openFolder: async () => {},
  revealFile: async () => {},
  getRuntime: async () => ({
    ready: false,
    installing: false,
    progress: 0,
    message: "브라우저 디자인 미리보기 · AI 렌더는 데스크톱 앱에서 실행됩니다.",
  }),
  installRuntime: async () => ({
    ready: false,
    installing: false,
    progress: 0,
    message: "데스크톱 앱을 설치하면 AI 환경이 자동으로 준비됩니다.",
  }),
  getSystem: async () => ({
    cuda: false,
    gpu: "데스크톱 앱에서 확인",
    vramGB: 0,
    freeVramGB: 0,
    torch: "—",
    python: "—",
    ffmpeg: false,
  }),
  checkForUpdates: async () => {},
  installUpdate: async () => {},
  onProgress: () => () => {},
  onRuntime: () => () => {},
  onUpdate: () => () => {},
};
export const api: DepthDeskAPI = window.depthdesk ?? demo;
export function mediaUrl(path: string) {
  if (/^(data:|blob:|depthdesk-media:)/.test(path)) return path;
  return isBrowserDemo
    ? (urls.get(path) ?? path)
    : `depthdesk-media://local/?path=${encodeURIComponent(path)}`;
}
