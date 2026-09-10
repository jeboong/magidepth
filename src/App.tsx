import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  Download,
  Expand,
  Film,
  Folder,
  FolderOpen,
  HelpCircle,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Monitor,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Sun,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  defaultPreferences,
  type DepthOptions,
  type MapKind,
  type Preferences,
  type PreviewResult,
  type ProgressEvent,
  type RenderResult,
  type RuntimeStatus,
  type SystemInfo,
  type UpdateStatus,
  type VideoInfo,
} from "../shared/contracts";
import { api, isBrowserDemo, mediaUrl } from "./lib/api";
import { cn, errorMessage, formatTime } from "./lib/utils";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Select,
  SelectItem,
  Slider,
  Switch,
  Tooltip,
  TooltipProvider,
} from "./components/ui/primitives";
import { Tutorial } from "./components/Tutorial";

type ViewMode = "compare" | "source" | "depth";
const initialRuntime: RuntimeStatus = {
  ready: false,
  installing: false,
  progress: 0,
  message: "AI 환경 확인 중…",
};
const presets = {
  speed: { model: "image-small", inputSize: 280 },
  balanced: { model: "video-small", inputSize: 392 },
  quality: { model: "video-small", inputSize: 518 },
} as const;
const mapTypes: { key: MapKind; name: string; caption: string }[] = [
  { key: "source", name: "RGB", caption: "원본 컬러" },
  { key: "depth", name: "Depth", caption: "깊이" },
  { key: "normal", name: "Normal", caption: "표면 방향" },
  { key: "alpha", name: "Alpha", caption: "피사체 마스크" },
  { key: "basecolor", name: "Base Color", caption: "기본 색상" },
  { key: "metallic", name: "Metallic", caption: "금속성" },
  { key: "roughness", name: "Roughness", caption: "거칠기" },
  { key: "specular", name: "Specular", caption: "반사 강도" },
];
function NumberField({
  label,
  value,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="time-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        min={0}
        max={max}
        step={0.01}
        value={Number(value.toFixed(3))}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(0, Math.min(max, v)));
        }}
      />
      <small>초</small>
    </label>
  );
}
function RangeSetting({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display?: string;
  disabled?: boolean;
}) {
  return (
    <div className="range-setting">
      <div>
        <span>{label}</span>
        <output>{display ?? value.toFixed(2)}</output>
      </div>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        disabled={disabled}
      />
    </div>
  );
}

export default function App() {
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences);
  const [loaded, setLoaded] = useState(false);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus>(initialRuntime);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [update, setUpdate] = useState<UpdateStatus>({ status: "idle" });
  const [time, setTime] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [view, setView] = useState<ViewMode>("compare");
  const [split, setSplit] = useState(50);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewSignature, setPreviewSignature] = useState("");
  const [job, setJob] = useState<{
    id: string;
    kind: "preview" | "render";
  } | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [opening, setOpening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const [settings, setSettings] = useState(false);
  const [savePath, setSavePath] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const activeJob = useRef<string | null>(null);
  const options = prefs.options;
  const busy = !!job;
  const canRender = !!video && runtime.ready && !busy && !isBrowserDemo;
  const isImage = video?.kind === "image";

  useEffect(() => {
    let alive = true;
    let systemRequested = false;
    const loadSystem = () => {
      if (systemRequested || !alive) return;
      systemRequested = true;
      // getSystem itself inspects the engine and emits runtime status. Do not turn
      // that readiness event into a recursive getSystem IPC loop.
      api.getSystem().then(value => { if (alive) setSystem(value); }).catch(() => {});
    };
    Promise.all([api.getPreferences(), api.getRuntime()])
      .then(([p, r]) => {
        if (!alive) return;
        setPrefs(p);
        setRuntime(r);
        setLoaded(true);
        if (r.ready) loadSystem();
        if (!p.tutorialDone && !isBrowserDemo) setTutorial(true);
      })
      .catch((e) => {
        setError(errorMessage(e));
        setLoaded(true);
      });
    const offRuntime = api.onRuntime((r) => {
      setRuntime(r);
      if (r.ready) loadSystem();
      else systemRequested = false;
    });
    const offProgress = api.onProgress((p) => {
      if (p.jobId === activeJob.current) setProgress(p);
    });
    const offUpdate = api.onUpdate(setUpdate);
    return () => {
      alive = false;
      offRuntime();
      offProgress();
      offUpdate();
    };
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        prefs.theme === "dark" || (prefs.theme === "system" && query.matches),
      );
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [prefs.theme]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  const savePrefs = useCallback((patch: Partial<Preferences>) => {
    setPrefs((old) => ({ ...old, ...patch }));
    api.setPreferences(patch).catch((e) => setError(errorMessage(e)));
  }, []);
  const changeOption = <K extends keyof DepthOptions>(
    key: K,
    value: DepthOptions[K],
  ) => savePrefs({ options: { ...options, [key]: value } });
  const seek = useCallback(
    (v: number) => {
      if (!video) return;
      const next = Math.max(
        0,
        Math.min(Math.max(0, video.duration - 1 / video.fps), v),
      );
      setTime(next);
      if (player.current) player.current.currentTime = next;
    },
    [video],
  );
  const step = useCallback(
    (delta: number) => {
      if (!video) return;
      setPlaying(false);
      player.current?.pause();
      seek((Math.round(time * video.fps) + delta) / video.fps);
    },
    [video, time, seek],
  );
  const openVideo = useCallback(
    async (path?: string) => {
      if (busy) return;
      setError("");
      try {
        const next = path ?? (await api.chooseVideo());
        if (!next) return;
        setOpening(true);
        const info = await api.probeVideo(next);
        if (
          info.kind !== "image" &&
          (!Number.isFinite(info.duration) || info.duration <= 0)
        )
          throw new Error(
            "미디어 정보를 확인할 수 없습니다. 다른 파일을 선택해 주세요.",
          );
        setVideo(info);
        setTime(0);
        setTrimStart(0);
        setTrimEnd(info.duration || 1);
        setPreview(null);
        setResult(null);
        setSavePath("");
        setPlaying(false);
        setView("compare");
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setOpening(false);
      }
    },
    [busy],
  );
  useEffect(() => {
    const paste = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.key.toLowerCase() === "v")) return;
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;
      if (
        !stage.current?.matches(":hover") &&
        !stage.current?.contains(document.activeElement)
      )
        return;
      e.preventDefault();
      void api
        .pasteClipboardImage()
        .then((path) =>
          path
            ? openVideo(path)
            : setToast(
                "클립보드에 이미지가 없습니다. 이미지를 복사한 후 다시 시도하세요.",
              ),
        )
        .catch((err) => setError(errorMessage(err)));
    };
    window.addEventListener("keydown", paste);
    return () => window.removeEventListener("keydown", paste);
  }, [openVideo]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable ||
        settings ||
        tutorial
      )
        return;
      if (e.ctrlKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openVideo();
      }
      if (!video) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      }
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        if (player.current) {
          if (player.current.paused) void player.current.play();
          else player.current.pause();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [video, step, openVideo, settings, tutorial]);
  const chooseDir = async () => {
    try {
      const dir = await api.chooseOutputDir();
      if (dir) {
        savePrefs({ outputDir: dir });
        setSavePath("");
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const outputDefault = (dir = prefs.outputDir) => {
    const stem = (video?.name ?? "media").replace(/\.[^.]+$/, "");
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .slice(0, 15)
      .replace("T", "_");
    return `${dir}${dir && !/[\\/]$/.test(dir) ? "\\" : ""}${stem}_maps_${stamp}.${isImage ? "png" : "mp4"}`;
  };
  const chooseSave = async () => {
    try {
      const path = await api.chooseSavePath(savePath || outputDefault());
      if (path) {
        setSavePath(path);
        const slash = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
        if (slash >= 0) savePrefs({ outputDir: path.slice(0, slash) });
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const runPreview = async () => {
    if (!video || !runtime.ready || busy) return;
    const id = crypto.randomUUID();
    activeJob.current = id;
    setJob({ id, kind: "preview" });
    setProgress(null);
    setError("");
    player.current?.pause();
    try {
      const value = await api.preview({
        jobId: id,
        path: video.path,
        time,
        options,
      });
      setPreview(value);
      setPreviewSignature(
        JSON.stringify({ ...options, maps: undefined, previewMap: undefined }),
      );
      setView("compare");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      activeJob.current = null;
      setJob(null);
      setCancelling(false);
    }
  };
  const runRender = async () => {
    if (!canRender || !video) return;
    if (trimEnd <= trimStart) {
      setError("종료 지점은 시작 지점보다 뒤에 있어야 합니다.");
      return;
    }
    let dir = prefs.outputDir;
    if (!dir && !savePath) {
      const chosen = await api.chooseOutputDir();
      if (!chosen) return;
      dir = chosen;
      savePrefs({ outputDir: dir });
    }
    const id = crypto.randomUUID();
    activeJob.current = id;
    setJob({ id, kind: "render" });
    setProgress(null);
    setResult(null);
    setError("");
    player.current?.pause();
    try {
      const value = await api.render({
        jobId: id,
        path: video.path,
        trimStart,
        trimEnd,
        outputPath: savePath || outputDefault(dir),
        options,
      });
      setResult(value);
      setToast("선택한 맵이 저장되었습니다.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      activeJob.current = null;
      setJob(null);
      setCancelling(false);
    }
  };
  const cancel = async () => {
    if (!job) return;
    setCancelling(true);
    try {
      await api.cancelJob(job.id);
    } catch (e) {
      setError(errorMessage(e));
      setCancelling(false);
    }
  };
  const install = async () => {
    setError("");
    try {
      setRuntime(await api.installRuntime());
    } catch (e) {
      setRuntime((old) => ({
        ...old,
        installing: false,
        error: errorMessage(e),
      }));
    }
  };
  const percentage = Math.round(
    Math.min(100, Math.max(0, (progress?.progress ?? 0) * 100)),
  );
  const runtimePercent = Math.round(
    Math.min(100, Math.max(0, runtime.progress * 100)),
  );
  const currentFrame = video
    ? Math.min(video.frames - 1, Math.round(time * video.fps))
    : 0;
  const previewStale =
    !!preview &&
    (preview.frame !== currentFrame ||
      previewSignature !==
        JSON.stringify({ ...options, maps: undefined, previewMap: undefined }));
  const selectedPreset = Object.entries(presets).find(
    ([, v]) => v.model === options.model && v.inputSize === options.inputSize,
  )?.[0];
  const sourceImage = preview?.source ? mediaUrl(preview.source) : "";
  const previewMap = options.previewMap ?? "depth";
  const mapImage =
    preview?.images?.[previewMap] ??
    (previewMap === "depth"
      ? preview?.image
      : previewMap === "source"
        ? preview?.source
        : undefined);
  const toggleMap = (map: MapKind) => {
    const selected = options.maps ?? ["depth"];
    const maps = selected.includes(map)
      ? selected.filter((v) => v !== map)
      : [...selected, map];
    if (!maps.length) {
      setToast("내보낼 맵을 하나 이상 선택해 주세요.");
      return;
    }
    savePrefs({
      options: {
        ...options,
        maps,
        previewMap: maps.includes(previewMap) ? previewMap : maps[0],
      },
    });
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className="app-shell"
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes("Files")) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void openVideo(api.getFilePath(file));
        }}
      >
        <header className="app-header">
          <a
            href="#"
            className="brand"
            onClick={(e) => e.preventDefault()}
            aria-label="MagiDepth 매지댑스 홈"
          >
            <span className="brand-icon">
              <Layers3 size={23} strokeWidth={1.6} />
              <img
                src={`${import.meta.env.BASE_URL}brand/magidepth.png`}
                alt=""
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </span>
            <span>
              Magi<span className="brand-light">Depth</span>
            </span>
            <span className="brand-tag">STUDIO</span>
          </a>
          <div className="header-right">
            <span className="local-badge">
              <span />
              로컬 AI · 프라이빗
            </span>
            <span className="header-divider" />
            <Tooltip label="사용 가이드">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTutorial(true)}
                aria-label="튜토리얼 열기"
              >
                <BookOpen />
              </Button>
            </Tooltip>
            <Tooltip
              label={
                prefs.theme === "dark"
                  ? "라이트 모드로 전환"
                  : "다크 모드로 전환"
              }
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  savePrefs({
                    theme: prefs.theme === "dark" ? "light" : "dark",
                  })
                }
                aria-label="테마 전환"
              >
                {prefs.theme === "dark" ? <Sun /> : <Moon />}
              </Button>
            </Tooltip>
            <Tooltip label="앱 설정 및 업데이트">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSettings(true)}
                aria-label="앱 설정"
              >
                <Settings2 />
              </Button>
            </Tooltip>
          </div>
        </header>
        <main className="workspace">
          <section className="editor-column">
            <div className="workspace-heading">
              <div>
                <div className="eyebrow">IMAGE & VIDEO TO MAPS</div>
                <h1>
                  새로운 차원을 발견하세요<span>.</span>
                </h1>
                <p>이미지와 영상, 그 안에 숨은 깊이와 표면을 꺼내다.</p>
              </div>
              <Button
                variant="outline"
                onClick={() => void openVideo()}
                disabled={busy || opening}
              >
                <FolderOpen />
                {opening ? "불러오는 중" : "파일 열기"}
                <kbd>Ctrl O</kbd>
              </Button>
            </div>
            {isBrowserDemo && (
              <div className="demo-notice">
                <Monitor size={13} />
                브라우저 UI 미리보기 — 실제 AI 렌더는 데스크톱 앱에서
                실행됩니다.
              </div>
            )}
            {!isBrowserDemo && !runtime.ready && (
              <div
                className={cn("runtime-banner", runtime.error && "has-error")}
              >
                <div>
                  <span className="runtime-banner-icon">
                    {runtime.installing ? (
                      <LoaderCircle size={17} className="animate-spin" />
                    ) : (
                      <Cpu size={17} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {runtime.error
                        ? "AI 환경을 준비하지 못했어요"
                        : runtime.installing
                          ? "처음 한 번, AI 작업 환경을 준비합니다."
                          : "AI 작업 환경이 필요합니다."}
                    </strong>
                    <p>{runtime.error || runtime.message}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      runtime.installing ? setSettings(true) : void install()
                    }
                  >
                    {runtime.installing
                      ? `${runtimePercent}% · 자세히`
                      : "설치 / 다시 시도"}
                  </Button>
                </div>
                {runtime.installing && (
                  <div className="runtime-banner-progress">
                    <i style={{ width: `${runtimePercent}%` }} />
                  </div>
                )}
              </div>
            )}
            {error && (
              <div role="alert" className="error-banner">
                <span>{error}</span>
                <button aria-label="오류 닫기" onClick={() => setError("")}>
                  <X size={14} />
                </button>
              </div>
            )}
            <section className="preview-panel">
              <div className="preview-toolbar">
                <div
                  className="preview-tabs"
                  role="tablist"
                  aria-label="미리보기 모드"
                >
                  {(
                    [
                      { id: "compare", label: "비교", icon: ArrowLeftRight },
                      { id: "source", label: "원본", icon: Film },
                      { id: "depth", label: "맵", icon: Layers3 },
                    ] as const
                  ).map((v) => (
                    <button
                      key={v.id}
                      role="tab"
                      aria-selected={view === v.id}
                      className={cn(view === v.id && "active")}
                      onClick={() => setView(v.id)}
                    >
                      <v.icon size={13} />
                      {v.label}
                    </button>
                  ))}
                </div>
                <div className="preview-tools">
                  {video && (
                    <span>
                      {video.width} × {video.height}
                    </span>
                  )}
                  <Tooltip label="미리보기 전체 화면">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        void stage.current?.requestFullscreen().catch(() => {})
                      }
                      aria-label="미리보기 전체 화면"
                    >
                      <Expand />
                    </Button>
                  </Tooltip>
                </div>
              </div>
              <div
                className="map-preview-tabs"
                role="tablist"
                aria-label="미리볼 맵 선택"
              >
                {mapTypes
                  .filter((m) => (options.maps ?? ["depth"]).includes(m.key))
                  .map((m) => (
                    <button
                      key={m.key}
                      role="tab"
                      aria-selected={previewMap === m.key}
                      className={cn(previewMap === m.key && "active")}
                      onClick={() => {
                        changeOption("previewMap", m.key);
                        if (view === "source") setView("depth");
                      }}
                    >
                      <span className={`map-dot map-${m.key}`} />
                      {m.name}
                    </button>
                  ))}
                <span className="preview-map-caption">
                  {isImage ? "STILL IMAGE" : "FRAME PREVIEW"}
                </span>
              </div>
              <div
                ref={stage}
                tabIndex={0}
                aria-label="미디어 작업 영역 · 이미지를 복사하고 이 영역에서 Ctrl V로 붙여넣기"
                className={cn("preview-stage", !video && "empty-stage")}
              >
                {!video ? (
                  <div className="empty-content">
                    <div className="depth-sculpture" aria-hidden="true">
                      <div className="sculpture-plane plane-1" />
                      <div className="sculpture-plane plane-2" />
                      <div className="sculpture-plane plane-3" />
                      <div className="sculpture-plane plane-4" />
                      <div className="sculpture-cross cross-1" />
                      <div className="sculpture-cross cross-2" />
                      <div className="sculpture-orbit" />
                    </div>
                    <h2>한 장면, 더 깊은 가능성.</h2>
                    <p>이미지나 영상을 드래그해 시작하세요.</p>
                    <Button onClick={() => void openVideo()} disabled={opening}>
                      <Upload size={15} />
                      파일 선택
                      <ArrowRight size={15} />
                    </Button>
                    <div className="format-chips">
                      <span>PNG / JPG</span>
                      <span>MP4 / MOV</span>
                      <span>Ctrl V 붙여넣기</span>
                    </div>
                    <div className="empty-private">
                      <ShieldCheck size={12} />
                      원본은 내 컴퓨터에만 머뭅니다.
                    </div>
                  </div>
                ) : (
                  <>
                    {isImage ? (
                      <img
                        className={cn(
                          "preview-media",
                          (view === "depth" ||
                            (view === "compare" && mapImage)) &&
                            "media-hidden",
                        )}
                        src={mediaUrl(video.path)}
                        alt="원본 이미지"
                      />
                    ) : (
                      <video
                        ref={player}
                        src={mediaUrl(video.path)}
                        className={cn(
                          "source-video",
                          (view === "depth" ||
                            (view === "compare" && mapImage && !playing)) &&
                            "media-hidden",
                        )}
                        preload="auto"
                        playsInline
                        onTimeUpdate={() => {
                          if (player.current)
                            setTime(player.current.currentTime);
                        }}
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        onEnded={() => setPlaying(false)}
                        onError={() =>
                          setToast(
                            "원본 재생이 지원되지 않는 코덱입니다. 프레임 미리보기를 이용하세요.",
                          )
                        }
                      />
                    )}
                    {!playing && mapImage && view === "compare" && (
                      <div className="compare-viewport">
                        <img
                          className="preview-media"
                          src={mediaUrl(mapImage)}
                          alt={`${previewMap} 추정 맵`}
                        />
                        <div
                          className="comparison-source"
                          style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
                        >
                          <img
                            className="preview-media"
                            src={sourceImage || mediaUrl(video.path)}
                            alt="원본 프레임"
                          />
                        </div>
                        <div
                          className="comparison-divider"
                          style={{ left: `${split}%` }}
                        >
                          <span>
                            <ChevronsLeft size={12} />
                            <ChevronsRight size={12} />
                          </span>
                        </div>
                        <input
                          type="range"
                          className="comparison-input"
                          min={0}
                          max={100}
                          value={split}
                          aria-label="원본과 맵 비교 경계"
                          onChange={(e) => setSplit(Number(e.target.value))}
                        />
                        <span className="media-label label-left">ORIGINAL</span>
                        <span className="media-label label-right">
                          {previewMap.toUpperCase()}
                        </span>
                      </div>
                    )}
                    {view === "depth" && mapImage && (
                      <img
                        className="preview-media"
                        src={mediaUrl(mapImage)}
                        alt={`${previewMap} 추정 맵`}
                      />
                    )}
                    {view === "depth" && !mapImage && (
                      <div className="depth-placeholder">
                        <Layers3 size={34} strokeWidth={1} />
                        <h3>
                          {mapTypes.find((m) => m.key === previewMap)?.name}{" "}
                          맵을 확인하세요.
                        </h3>
                        <p>
                          {isImage
                            ? "이미지를 먼저 렌더해 보세요."
                            : "한 프레임을 먼저 렌더해 보세요."}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void runPreview()}
                          disabled={!canRender}
                        >
                          <Sparkles />
                          미리보기 렌더
                        </Button>
                      </div>
                    )}
                    {view !== "depth" && (!preview || playing) && (
                      <>
                        <span className="media-label label-left">ORIGINAL</span>
                        {!preview && (
                          <div className="preview-invitation">
                            <Sparkles size={14} />
                            프레임을 렌더하면 원본과 비교할 수 있어요
                          </div>
                        )}
                      </>
                    )}
                    {preview && (
                      <span className="preview-info">
                        F{preview.frame + 1}
                        {previewStale
                          ? " · 이전 미리보기"
                          : ` · ${preview.elapsed.toFixed(1)}s`}
                      </span>
                    )}
                  </>
                )}
                {opening && (
                  <div className="stage-loading">
                    <LoaderCircle className="animate-spin" size={24} />
                    <span>영상 정보를 불러오는 중…</span>
                  </div>
                )}
                {job?.kind === "preview" && (
                  <div className="stage-loading">
                    <LoaderCircle className="animate-spin" size={24} />
                    <span>
                      {progress?.message ||
                        "현재 프레임에서 깊이를 추정하는 중…"}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void cancel()}
                      disabled={cancelling}
                    >
                      취소
                    </Button>
                  </div>
                )}
              </div>
              {!isImage ? (
                <div className="timeline">
                  <div className="timeline-top">
                    <div className="playback-controls">
                      <Tooltip label="이전 프레임 (←)">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="이전 프레임"
                          onClick={() => step(-1)}
                          disabled={!video || busy}
                        >
                          <ChevronsLeft />
                        </Button>
                      </Tooltip>
                      <Button
                        variant="secondary"
                        size="icon"
                        aria-label={playing ? "일시 정지" : "원본 재생"}
                        disabled={!video}
                        onClick={() => {
                          if (player.current) {
                            if (playing) player.current.pause();
                            else {
                              setView("source");
                              void player.current
                                .play()
                                .catch(() =>
                                  setError(
                                    "원본 재생이 지원되지 않습니다. 프레임 미리보기를 사용해 주세요.",
                                  ),
                                );
                            }
                          }
                        }}
                      >
                        {playing ? (
                          <Pause />
                        ) : (
                          <Play size={14} fill="currentColor" />
                        )}
                      </Button>
                      <Tooltip label="다음 프레임 (→)">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="다음 프레임"
                          onClick={() => step(1)}
                          disabled={!video || busy}
                        >
                          <ChevronsRight />
                        </Button>
                      </Tooltip>
                      <span className="timecode">
                        {formatTime(time, true)}
                        <span>/ {formatTime(video?.duration ?? 0, true)}</span>
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runPreview()}
                      disabled={!canRender}
                    >
                      <Sparkles />
                      {job?.kind === "preview" ? "렌더 중…" : "프레임 미리보기"}
                    </Button>
                  </div>
                  <div className="timeline-track">
                    <div className="timeline-ticks" aria-hidden="true">
                      {Array.from({ length: 41 }, (_, i) => (
                        <i key={i} className={i % 5 === 0 ? "major" : ""} />
                      ))}
                    </div>
                    <Slider
                      aria-label="재생 위치"
                      min={0}
                      max={
                        video
                          ? Math.max(0.01, video.duration - 1 / video.fps)
                          : 1
                      }
                      step={video ? 1 / video.fps : 0.01}
                      value={[time]}
                      onValueChange={(v) => seek(v[0])}
                      disabled={!video || busy}
                    />
                    <div className="timeline-labels">
                      <span>00:00</span>
                      <span>
                        {video ? formatTime(video.duration / 2) : "—"}
                      </span>
                      <span>{video ? formatTime(video.duration) : "—"}</span>
                    </div>
                  </div>
                  <div className="trim-row">
                    <span className="trim-label">
                      <Scissors size={13} />
                      구간 자르기
                    </span>
                    <NumberField
                      label="시작"
                      value={trimStart}
                      max={video?.duration ?? 0}
                      onChange={(v) => setTrimStart(Math.min(v, trimEnd))}
                      disabled={!video || busy}
                    />
                    <Tooltip label="현재 프레임을 시작 지점으로">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="trim-current"
                        aria-label="현재 위치를 시작으로"
                        onClick={() => setTrimStart(Math.min(time, trimEnd))}
                        disabled={!video || busy}
                      >
                        [
                      </Button>
                    </Tooltip>
                    <span className="trim-dash">—</span>
                    <NumberField
                      label="종료"
                      value={trimEnd}
                      max={video?.duration ?? 0}
                      onChange={(v) => setTrimEnd(Math.max(trimStart, v))}
                      disabled={!video || busy}
                    />
                    <Tooltip label="현재 프레임까지 포함하여 종료 지점으로">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="trim-current"
                        aria-label="현재 위치를 종료로"
                        onClick={() =>
                          setTrimEnd(
                            Math.max(
                              trimStart,
                              Math.min(
                                video?.duration ?? 0,
                                time + 1 / (video?.fps ?? 30),
                              ),
                            ),
                          )
                        }
                        disabled={!video || busy}
                      >
                        ]
                      </Button>
                    </Tooltip>
                    <span className="trim-duration">
                      {formatTime(Math.max(0, trimEnd - trimStart), true)} 선택
                    </span>
                    <Tooltip label="전체 구간으로 복원">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="트림 초기화"
                        disabled={!video || busy}
                        onClick={() => {
                          setTrimStart(0);
                          setTrimEnd(video?.duration ?? 0);
                        }}
                      >
                        <RefreshCw size={12} />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              ) : (
                <div className="image-preview-toolbar">
                  <span>
                    <ImageIcon size={14} />
                    이미지 작업 · 한 번에 선택한 모든 맵을 저장
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void runPreview()}
                    disabled={!canRender}
                  >
                    <Sparkles />
                    {job?.kind === "preview" ? "렌더 중…" : "이미지 미리보기"}
                  </Button>
                </div>
              )}
            </section>
            <div className="below-preview">
              {video ? (
                <>
                  <span className="file-name">
                    <Film size={14} />
                    {video.name}
                  </span>
                  <span>
                    {isImage ? (
                      "STILL IMAGE · PNG 출력"
                    ) : (
                      <>
                        {isBrowserDemo
                          ? "브라우저 예상 프레임레이트"
                          : `${video.fps.toFixed(2)} fps`}{" "}
                        · {video.frames.toLocaleString()} frames
                      </>
                    )}
                  </span>
                </>
              ) : (
                <>
                  <span>
                    <CheckCircle2 size={14} />
                    원본을 그대로 보존합니다
                  </span>
                  <span>GPU 가속 · 오프라인 처리</span>
                </>
              )}
            </div>
            {result && (
              <div className="result-card">
                <span className="result-icon">
                  <Check size={20} />
                </span>
                <div>
                  <strong>
                    {isImage ? "이미지 맵" : "영상 맵"}이 완성되었습니다.
                  </strong>
                  <p>
                    {Object.keys(result.outputPaths ?? {}).length || 1}개 파일 ·{" "}
                    {result.elapsed.toFixed(1)}초 소요
                    {!isImage && ` · ${result.fps.toFixed(1)} fps`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void api
                      .revealFile(result.outputPath)
                      .catch((e) => setError(errorMessage(e)))
                  }
                >
                  <FolderOpen />
                  결과 보기
                </Button>
              </div>
            )}
            <footer className="editor-footer">
              <span>LESS FRICTION. MORE DIMENSION.</span>
              <button onClick={() => setTutorial(true)}>
                처음 사용하시나요?{" "}
                <span>
                  빠른 시작 가이드 <ArrowRight size={12} />
                </span>
              </button>
            </footer>
          </section>
          <aside className="settings-column">
            <div className="settings-title">
              <div>
                <SlidersHorizontal size={16} />
                <h2>렌더 설정</h2>
              </div>
              <Tooltip label="설정을 기본값으로 초기화">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    savePrefs({ options: { ...defaultPreferences.options } })
                  }
                  disabled={busy}
                  aria-label="렌더 설정 초기화"
                >
                  <RefreshCw size={14} />
                </Button>
              </Tooltip>
            </div>
            <div className="settings-scroll">
              <section className="setting-section map-selection-section">
                <div className="section-heading">
                  <h3>추출할 맵</h3>
                  <span>{options.maps.length} SELECTED</span>
                </div>
                <div className="map-selection-grid">
                  {mapTypes.map((m) => (
                    <button
                      key={m.key}
                      role="checkbox"
                      aria-checked={options.maps.includes(m.key)}
                      aria-label={`${m.name} ${m.caption} 추출`}
                      disabled={busy}
                      onClick={() => toggleMap(m.key)}
                      className={cn(
                        "map-card",
                        options.maps.includes(m.key) && "selected",
                      )}
                    >
                      <span className={`map-swatch map-${m.key}`} />
                      <span>
                        <strong>{m.name}</strong>
                        <small>{m.caption}</small>
                      </span>
                      <span className="map-check">
                        {options.maps.includes(m.key) && <Check size={9} />}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="processing-mode">
                  <button
                    onClick={() => changeOption("processingMode", "fast")}
                    disabled={busy}
                    className={cn(
                      options.processingMode === "fast" && "active",
                    )}
                  >
                    <Zap size={12} />
                    빠른 처리
                  </button>
                  <button
                    onClick={() => changeOption("processingMode", "advanced")}
                    disabled={busy}
                    className={cn(
                      options.processingMode === "advanced" && "active",
                    )}
                  >
                    <Sparkles size={12} />
                    고급 AI
                  </button>
                </div>
                <p className="setting-hint">
                  {options.processingMode === "advanced"
                    ? "Marigold AI로 Normal·재질 맵을 추정합니다. 추가 모델 다운로드 및 처리 시간이 필요합니다."
                    : "Depth AI 기반으로 빠르게 처리합니다. Normal·재질 맵은 경량 근사 결과입니다."}{" "}
                  Specular는 반사 근사값입니다.
                </p>
              </section>
              <section className="setting-section">
                <div className="section-heading">
                  <h3>작업 스타일</h3>
                  <span>PRESET</span>
                </div>
                <div className="preset-grid">
                  {(
                    [
                      { key: "speed", label: "스피드", icon: Zap },
                      { key: "balanced", label: "밸런스", icon: Layers3 },
                      { key: "quality", label: "디테일", icon: Sparkles },
                    ] as const
                  ).map((p) => (
                    <button
                      key={p.key}
                      className={cn(
                        "preset",
                        selectedPreset === p.key && "selected",
                      )}
                      disabled={busy}
                      onClick={() =>
                        savePrefs({
                          options: { ...options, ...presets[p.key] },
                        })
                      }
                    >
                      <p.icon size={18} strokeWidth={1.5} />
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
                <p className="setting-hint">
                  {selectedPreset === "speed"
                    ? "최소 지연, 빠른 프레임 처리에 집중합니다."
                    : selectedPreset === "quality"
                      ? "더 큰 입력 해상도로 세부 깊이를 살립니다."
                      : "시간적 일관성과 처리 속도의 균형을 맞춥니다."}
                </p>
              </section>
              <section className="setting-section">
                <div className="section-heading">
                  <h3>AI 모델</h3>
                  <span className="subtle-pill">LOCAL</span>
                </div>
                <Select
                  label="AI 모델"
                  value={options.model}
                  onValueChange={(v) =>
                    changeOption("model", v as DepthOptions["model"])
                  }
                  disabled={busy}
                >
                  <SelectItem value="video-small">
                    Video Depth Anything · Small
                  </SelectItem>
                  <SelectItem value="image-small">
                    Depth Anything V2 · Small
                  </SelectItem>
                </Select>
                <div className="model-note">
                  <span
                    className={
                      options.model === "video-small"
                        ? "note-dot"
                        : "note-dot muted"
                    }
                  />
                  {options.model === "video-small"
                    ? "시간축을 고려한 영상 전용 모델"
                    : "가벼운 프레임별 추정 · 빠른 미리보기"}
                </div>
                <div className="setting-label-row">
                  <span>AI 입력 해상도</span>
                  <Tooltip label="모델 입력 크기입니다. 결과 영상 해상도와는 별개이며 높일수록 처리 시간이 늘어납니다.">
                    <button aria-label="입력 해상도 설명">
                      <HelpCircle size={12} />
                    </button>
                  </Tooltip>
                </div>
                <div className="size-options">
                  {[280, 392, 518, 700].map((n) => (
                    <button
                      key={n}
                      disabled={busy}
                      className={cn(options.inputSize === n && "active")}
                      onClick={() =>
                        changeOption(
                          "inputSize",
                          n as DepthOptions["inputSize"],
                        )
                      }
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </section>
              <section className="setting-section">
                <div className="section-heading">
                  <h3>깊이 표현</h3>
                  <span>LOOK</span>
                </div>
                <div className="polarity-setting">
                  <div
                    className="depth-ramp"
                    style={{
                      background: options.nearWhite
                        ? "linear-gradient(90deg,#1a1a1a,#f4f4f4)"
                        : "linear-gradient(90deg,#f4f4f4,#1a1a1a)",
                    }}
                  />
                  <div className="polarity-row">
                    <span>
                      {options.nearWhite
                        ? "가까울수록 밝게"
                        : "가까울수록 어둡게"}
                    </span>
                    <Switch
                      aria-label="가까울수록 밝게"
                      checked={options.nearWhite}
                      onCheckedChange={(v) => changeOption("nearWhite", v)}
                      disabled={busy}
                    />
                  </div>
                </div>
                <RangeSetting
                  label="감마"
                  value={options.gamma}
                  min={0.2}
                  max={3}
                  step={0.05}
                  onChange={(v) => changeOption("gamma", v)}
                  disabled={busy}
                />
                <RangeSetting
                  label="대비"
                  value={options.contrast}
                  min={0}
                  max={1}
                  step={0.05}
                  display={`${Math.round(options.contrast * 100)}%`}
                  onChange={(v) => changeOption("contrast", v)}
                  disabled={busy}
                />
                {options.maps.includes("normal") && (
                  <RangeSetting
                    label="노멀 강도"
                    value={options.normalStrength}
                    min={0.1}
                    max={5}
                    step={0.1}
                    onChange={(v) => changeOption("normalStrength", v)}
                    disabled={busy}
                  />
                )}
                {options.processingMode === "advanced" && (
                  <div className="advanced-step-setting">
                    <div className="setting-label-row">
                      <span>고급 AI 추론 단계</span>
                    </div>
                    <Select
                      label="고급 AI 추론 단계"
                      value={String(options.steps)}
                      onValueChange={(v) =>
                        changeOption(
                          "steps",
                          Number(v) as DepthOptions["steps"],
                        )
                      }
                      disabled={busy}
                    >
                      {[1, 2, 4, 8].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} 단계{n === 4 ? " · 권장" : ""}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                )}
              </section>
              <section className="setting-section">
                <div className="section-heading">
                  <h3>내보내기</h3>
                  <span>OUTPUT</span>
                </div>
                <div className="two-fields">
                  <label>
                    <span>출력 해상도</span>
                    <Select
                      label="출력 해상도"
                      value={options.outputSize}
                      onValueChange={(v) =>
                        changeOption(
                          "outputSize",
                          v as DepthOptions["outputSize"],
                        )
                      }
                      disabled={busy}
                    >
                      <SelectItem value="source">원본 유지</SelectItem>
                      <SelectItem value="1080">최대 1080p</SelectItem>
                      <SelectItem value="720">최대 720p</SelectItem>
                    </Select>
                  </label>
                  <label>
                    <span>{isImage ? "이미지 형식" : "코덱"}</span>
                    {isImage ? (
                      <div className="format-readonly">PNG · 무손실</div>
                    ) : (
                      <Select
                        label="출력 코덱"
                        value={options.codec}
                        onValueChange={(v) =>
                          changeOption("codec", v as DepthOptions["codec"])
                        }
                        disabled={busy}
                      >
                        <SelectItem value="h264">H.264 · MP4</SelectItem>
                        <SelectItem value="hevc">HEVC · MP4</SelectItem>
                      </Select>
                    )}
                  </label>
                </div>
                <button
                  className="advanced-toggle"
                  onClick={() => setAdvanced(!advanced)}
                  aria-expanded={advanced}
                >
                  <span>
                    <Cpu size={13} />
                    고급 설정
                  </span>
                  {advanced ? (
                    <ChevronDown size={13} />
                  ) : (
                    <ChevronRight size={13} />
                  )}
                </button>
                {advanced && (
                  <div className="two-fields advanced-fields">
                    <label>
                      <span>연산 장치</span>
                      <Select
                        label="연산 장치"
                        value={options.device}
                        onValueChange={(v) =>
                          changeOption("device", v as DepthOptions["device"])
                        }
                        disabled={busy}
                      >
                        <SelectItem value="auto">자동 감지</SelectItem>
                        <SelectItem value="cuda">NVIDIA GPU</SelectItem>
                        <SelectItem value="cpu">CPU</SelectItem>
                      </Select>
                    </label>
                    <label>
                      <span>연산 정밀도</span>
                      <Select
                        label="연산 정밀도"
                        value={options.precision}
                        onValueChange={(v) =>
                          changeOption(
                            "precision",
                            v as DepthOptions["precision"],
                          )
                        }
                        disabled={busy}
                      >
                        <SelectItem value="auto">자동 최적화</SelectItem>
                        <SelectItem value="fp16">FP16</SelectItem>
                        <SelectItem value="fp32">FP32</SelectItem>
                      </Select>
                    </label>
                  </div>
                )}
              </section>
            </div>
            <div className="export-section">
              <div className="output-label">
                <span>
                  저장 위치{" "}
                  <span className="remembered">
                    <Check size={10} />
                    자동 기억
                  </span>
                </span>
                {prefs.outputDir && (
                  <Tooltip label="저장 폴더 열기">
                    <button
                      aria-label="저장 폴더 열기"
                      onClick={() =>
                        void api
                          .openFolder(prefs.outputDir)
                          .catch((e) => setError(errorMessage(e)))
                      }
                    >
                      <FolderOpen size={14} />
                    </button>
                  </Tooltip>
                )}
              </div>
              <button
                className="folder-picker"
                onClick={() => void chooseDir()}
                disabled={busy}
                title={savePath || prefs.outputDir}
              >
                <Folder size={15} />
                <span>
                  {savePath || prefs.outputDir || "저장할 폴더를 선택하세요"}
                </span>
                <MoreHorizontal size={16} />
              </button>
              <div className="save-as-row">
                <span>
                  {isImage
                    ? "PNG 이미지 · 맵별 개별 파일"
                    : "MP4 영상 · 맵별 파일, 오디오 제외"}
                </span>
                <button
                  onClick={() => void chooseSave()}
                  disabled={busy || !video}
                >
                  다른 이름으로 저장
                </button>
              </div>
              {busy ? (
                <div className="render-progress">
                  <div>
                    <span>
                      <LoaderCircle size={13} className="animate-spin" />
                      {job.kind === "preview"
                        ? "프레임 분석 중"
                        : "영상 렌더 중"}
                    </span>
                    <strong>{percentage}%</strong>
                  </div>
                  <div className="progress-track">
                    <i style={{ width: `${percentage}%` }} />
                  </div>
                  <p>{progress?.message || "모델을 준비하고 있습니다…"}</p>
                  {progress?.fps != null && (
                    <div className="progress-metrics">
                      <span>{progress.fps.toFixed(1)} fps</span>
                      {progress.eta != null && (
                        <span>약 {formatTime(progress.eta)} 남음</span>
                      )}
                    </div>
                  )}
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => void cancel()}
                    disabled={cancelling}
                  >
                    <Square size={12} />
                    {cancelling ? "안전하게 중지하는 중…" : "작업 취소"}
                  </Button>
                </div>
              ) : (
                <Button
                  className="export-button w-full"
                  size="lg"
                  disabled={!canRender || trimEnd <= trimStart}
                  onClick={() => void runRender()}
                >
                  <ArrowDownToLine size={16} />
                  {options.maps.length}개 맵 {isImage ? "이미지" : "영상"}{" "}
                  내보내기
                  <ArrowRight size={15} />
                </Button>
              )}
              <div className="export-footnote">
                <ShieldCheck size={11} />
                {!video
                  ? "이미지나 영상을 불러오면 시작할 수 있습니다."
                  : !runtime.ready
                    ? "AI 환경 준비 후 렌더할 수 있습니다."
                    : `원본은 그대로, 새로운 ${isImage ? "PNG" : "MP4"}로 저장됩니다.`}
              </div>
            </div>
          </aside>
        </main>
        <footer className="status-bar">
          <div
            className={cn(
              "runtime-status",
              runtime.ready && "ready",
              runtime.error && "failed",
            )}
          >
            <span className="status-dot" />
            {runtime.installing ? (
              <>
                <LoaderCircle size={11} className="animate-spin" />
                AI 환경 설치 중 · {runtimePercent}%
              </>
            ) : runtime.ready ? (
              <>
                {system?.cuda ? system.gpu : "AI 환경 준비 완료"}
                {system?.cuda && system.vramGB > 0 && (
                  <span className="status-dim">
                    {system.vramGB.toFixed(0)} GB
                  </span>
                )}
              </>
            ) : (
              <>
                <span>
                  {isBrowserDemo
                    ? "브라우저 프리뷰"
                    : runtime.error
                      ? "AI 환경 설치 실패"
                      : runtime.message}
                </span>
                {loaded && !isBrowserDemo && (
                  <button onClick={() => void install()}>
                    {runtime.error ? "다시 시도" : "환경 설치"}
                    <ArrowRight size={11} />
                  </button>
                )}
              </>
            )}
          </div>
          <div className="status-right">
            {runtime.installing && (
              <span className="runtime-mini-progress">
                <i style={{ width: `${runtimePercent}%` }} />
              </span>
            )}
            <span>
              MagiDepth {system?.appVersion ? `v${system.appVersion}` : ""}
            </span>
            <button
              onClick={() => setSettings(true)}
              className={cn(update.status === "ready" && "update-ready")}
            >
              {update.status === "ready" ? (
                <>
                  <Download size={11} />
                  업데이트 준비 완료
                </>
              ) : (
                <>
                  <span className="tiny-dot" />
                  자동 업데이트
                </>
              )}
            </button>
          </div>
        </footer>
        {dragging && (
          <div className="drop-overlay">
            <div>
              <Upload size={40} strokeWidth={1.2} />
              <h2>여기에 놓아 주세요.</h2>
              <p>새로운 뎁스 작업을 시작합니다.</p>
            </div>
          </div>
        )}
        {toast && (
          <div role="status" className="toast">
            <CheckCircle2 size={16} />
            {toast}
          </div>
        )}
        <Tutorial
          open={tutorial}
          onClose={() => {
            setTutorial(false);
            savePrefs({ tutorialDone: true });
          }}
        />
        <Dialog open={settings} onOpenChange={setSettings}>
          <DialogContent>
            <div className="eyebrow">YOUR WORKSPACE</div>
            <DialogTitle className="mt-2 text-xl font-semibold">
              앱 설정
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-muted-foreground">
              내 작업 환경을 편안하게 관리하세요.
            </DialogDescription>
            <div className="settings-modal-section">
              <h3>화면 모드</h3>
              <div className="theme-options">
                {(
                  [
                    { value: "light", label: "라이트", icon: Sun },
                    { value: "dark", label: "다크", icon: Moon },
                    { value: "system", label: "시스템", icon: Monitor },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.value}
                    className={cn(prefs.theme === t.value && "active")}
                    onClick={() => savePrefs({ theme: t.value })}
                  >
                    <t.icon size={18} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-modal-section">
              <div className="flex items-center justify-between">
                <h3>자동 업데이트</h3>
                <Switch
                  checked={prefs.autoUpdate}
                  onCheckedChange={(v) => savePrefs({ autoUpdate: v })}
                  aria-label="자동 업데이트"
                />
              </div>
              <p>
                새 버전이 있으면 다운로드합니다. 적용 시 앱이 다시 시작됩니다.
              </p>
              <div className="update-actions">
                <span>
                  {update.message ||
                    (update.status === "ready"
                      ? `v${update.version} 설치 준비 완료`
                      : update.status === "up-to-date"
                        ? "최신 버전입니다."
                        : `현재 버전 ${system?.appVersion ?? "확인 중"}`)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void (
                      update.status === "ready"
                        ? api.installUpdate()
                        : api.checkForUpdates()
                    ).catch((e) => setError(errorMessage(e)))
                  }
                  disabled={
                    isBrowserDemo ||
                    update.status === "checking" ||
                    update.status === "downloading"
                  }
                >
                  {update.status === "ready"
                    ? "재시작 및 적용"
                    : update.status === "checking"
                      ? "확인 중…"
                      : "업데이트 확인"}
                </Button>
              </div>
            </div>
            <div className="settings-modal-section">
              <h3>AI 실행 환경</h3>
              <div className="system-info">
                <span>그래픽 장치</span>
                <strong>{system?.gpu ?? "확인 중"}</strong>
                <span>PyTorch</span>
                <strong>{system?.torch ?? "—"}</strong>
                <span>Python</span>
                <strong>{system?.python ?? "—"}</strong>
                <span>FFmpeg</span>
                <strong>{system?.ffmpeg ? "준비 완료" : "미설치"}</strong>
              </div>
              {runtime.error && (
                <p className="text-destructive">{runtime.error}</p>
              )}
              {!runtime.ready && (
                <>
                  <p>{runtime.message}</p>
                  <Button
                    className="mt-3"
                    variant="outline"
                    size="sm"
                    onClick={() => void install()}
                    disabled={runtime.installing || isBrowserDemo}
                  >
                    <Download />
                    {runtime.installing
                      ? `설치 중 ${runtimePercent}%`
                      : "AI 환경 설치 / 다시 시도"}
                  </Button>
                </>
              )}
            </div>
            <div className="settings-modal-section">
              <h3>도움말</h3>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setSettings(false);
                  setTutorial(true);
                }}
              >
                <BookOpen />
                빠른 시작 가이드 다시 보기
              </Button>
              <p className="mt-3">
                AI가 추정한 상대 깊이입니다. 정확한 물리 거리 측정 용도가
                아닙니다.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
