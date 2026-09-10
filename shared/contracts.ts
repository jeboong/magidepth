export type ModelId = 'video-small' | 'image-small';
export type MapKind = 'source' | 'depth' | 'normal' | 'alpha' | 'basecolor' | 'metallic' | 'roughness' | 'specular';
export interface DepthOptions {
  maps: MapKind[];
  processingMode: 'fast' | 'advanced';
  previewMap: MapKind;
  normalStrength: number;
  steps: 1 | 2 | 4 | 8;
  model: ModelId;
  inputSize: 280 | 392 | 518 | 700;
  nearWhite: boolean;
  gamma: number;
  contrast: number;
  device: 'auto' | 'cuda' | 'cpu';
  precision: 'auto' | 'fp16' | 'fp32';
  outputSize: 'source' | '1080' | '720';
  codec: 'h264' | 'hevc';
}
export interface Preferences {
  theme: 'dark' | 'light' | 'system';
  outputDir: string;
  tutorialDone: boolean;
  autoUpdate: boolean;
  options: DepthOptions;
}
export interface VideoInfo {
  kind: 'video' | 'image';
  path: string; name: string; width: number; height: number;
  fps: number; frames: number; duration: number; hasAudio: boolean;
}
export interface ProgressEvent {
  jobId: string; stage: string; progress: number; message: string;
  fps?: number; eta?: number; frame?: number; totalFrames?: number;
}
export interface RuntimeStatus {
  ready: boolean; installing: boolean; progress: number; message: string;
  error?: string; pythonPath?: string;
}
export interface SystemInfo {
  cuda: boolean; gpu: string; vramGB: number; freeVramGB: number;
  torch: string; python: string; ffmpeg: boolean; appVersion?: string;
}
export interface PreviewResult { image: string; source: string; images?: Partial<Record<MapKind,string>>; elapsed: number; frame: number; width: number; height: number; }
export interface RenderResult { outputPath: string; outputPaths?: Partial<Record<MapKind,string>>; frames: number; elapsed: number; fps: number; }
export interface UpdateStatus { status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'; version?: string; percent?: number; message?: string; }
export interface DepthDeskAPI {
  getPreferences(): Promise<Preferences>;
  setPreferences(prefs: Partial<Preferences>): Promise<Preferences>;
  chooseVideo(): Promise<string | null>;
  pasteClipboardImage(): Promise<string | null>;
  getFilePath(file: File): string;
  probeVideo(path: string): Promise<VideoInfo>;
  preview(request: {jobId: string; path: string; time: number; options: DepthOptions}): Promise<PreviewResult>;
  render(request: {jobId: string; path: string; trimStart: number; trimEnd: number; outputPath: string; options: DepthOptions}): Promise<RenderResult>;
  cancelJob(jobId: string): Promise<void>;
  chooseOutputDir(): Promise<string | null>;
  chooseSavePath(defaultPath: string): Promise<string | null>;
  openFolder(path: string): Promise<void>;
  revealFile(path: string): Promise<void>;
  getRuntime(): Promise<RuntimeStatus>;
  installRuntime(): Promise<RuntimeStatus>;
  getSystem(): Promise<SystemInfo>;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  onProgress(cb: (event: ProgressEvent) => void): () => void;
  onRuntime(cb: (event: RuntimeStatus) => void): () => void;
  onUpdate(cb: (event: UpdateStatus) => void): () => void;
}
export const defaultOptions: DepthOptions = {
  maps: ['depth'], processingMode: 'fast', previewMap: 'depth', normalStrength: 1, steps: 4,
  model: 'video-small', inputSize: 392, nearWhite: true, gamma: 1,
  contrast: 0.5, device: 'auto', precision: 'auto', outputSize: 'source', codec: 'h264',
};
export const defaultPreferences: Preferences = {
  theme: 'dark', outputDir: '', tutorialDone: false, autoUpdate: true, options: defaultOptions,
};
