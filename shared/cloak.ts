/** Values intentionally match Seedance Cloak's original RenderConfig/GridParams. */
export type CloakQuality = 'visually_lossless' | 'high' | 'balanced' | 'small' | 'lossless' | 'hevc_high';
export interface ManualGrid {id: string; cx: number; cy: number; w: number; h: number;}
export interface CloakOptions {
  methods: {A: boolean; B: boolean; C: boolean};
  eps: number; strength: number; use_grid: boolean; tracking: boolean;
  quality: CloakQuality; pad_enabled: boolean; pad_seconds: number; pad_position: 'before' | 'after';
  roi_shape: 'ellipse' | 'rect'; detect_score: number;
  man_cx: number; man_cy: number; man_w: number; man_h: number;
  /** null migrates the legacy single box; [] means explicitly no manual grids. */
  manual_grids: ManualGrid[] | null;
  grid: {
    rows: number; cols: number; thickness: number; auto_thickness: boolean;
    /** OpenCV BGR, not RGB. Convert explicitly in the color picker. */
    color: [number, number, number]; opacity: number; margin: number;
    shape: 'ellipse' | 'rect'; align_angle: boolean; dots: boolean;
    dot_radius: number; line_aa: boolean;
  };
}
export const defaultCloakOptions: CloakOptions = {
  methods: {A: false, B: false, C: false}, eps: 6, strength: .05,
  use_grid: true, tracking: true, quality: 'visually_lossless',
  pad_enabled: false, pad_seconds: 4, pad_position: 'after', roi_shape: 'ellipse', detect_score: .6,
  man_cx: .5, man_cy: .5, man_w: .35, man_h: .45,
  manual_grids: null,
  grid: {rows: 6, cols: 6, thickness: 2, auto_thickness: true,
    color: [255, 255, 255], opacity: .6, margin: .06, shape: 'ellipse',
    align_angle: true, dots: false, dot_radius: 3, line_aa: true},
};
export interface CloakPreviewResult {
  source: string; image: string; elapsed: number; frame: number;
  width: number; height: number; faceCount: number; detector: string;
}
export interface CloakRenderResult {outputs: string[]; frames: number; elapsed: number; fps: number;}
export interface CloakProgressEvent {
  jobId: string; stage: string; progress: number; message: string;
  frame?: number; totalFrames?: number; fileIndex?: number; totalFiles?: number;
  fps?: number; eta?: number; preview?: string; outputPath?: string;
}
