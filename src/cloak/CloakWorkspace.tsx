import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDownToLine,
  TriangleAlert,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Files,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Loader2,
  MousePointer2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScanFace,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import {
  defaultCloakOptions,
  type CloakOptions,
  type CloakPreviewResult,
  type CloakProgressEvent,
  type CloakQuality,
  type Preferences,
  type RuntimeStatus,
  type VideoInfo,
} from "../../shared/contracts";
import { api, isBrowserDemo, mediaUrl } from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectItem,
  Slider,
  Switch,
  Tooltip,
} from "../components/ui/primitives";
import { CloakTutorial } from "./CloakTutorial";

type Media = VideoInfo & { thumbnail?: string };
type Props = {
  active: boolean;
  runtime: RuntimeStatus;
  prefs: Preferences;
  savePreferences: (patch: Partial<Preferences>) => void;
  externalBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  tutorialOpen: boolean;
  onTutorialClose: () => void;
  onTutorialOpen: () => void;
  onOpenSettings: () => void;
};
const qualityInfo: Record<CloakQuality, { label: string; detail: string }> = {
  visually_lossless: {
    label: "원본에 가까운 품질 · 권장",
    detail: "H.264 · CRF 14 · slow. 시각적 손실을 줄입니다.",
  },
  high: {
    label: "고품질",
    detail: "H.264 · CRF 18 · medium. 품질과 용량의 균형.",
  },
  balanced: { label: "표준 · 빠른 인코딩", detail: "H.264 · CRF 20 · fast." },
  small: {
    label: "작은 파일",
    detail: "H.264 · CRF 28 · veryfast. 화질 손실이 커집니다.",
  },
  lossless: {
    label: "코덱 무손실 · 큰 파일",
    detail:
      "H.264 · QP 0 · yuv444p. 색공간 변환이 있어 원본 RGB와 픽셀 동일하지 않습니다.",
  },
  hevc_high: {
    label: "HEVC 고품질",
    detail: "H.265 · CRF 20 · medium. 재생 앱의 H.265 호환성을 확인하세요.",
  },
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const seconds = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toFixed(2).padStart(5, "0")}`;
const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const uid = () => `cloak-${crypto.randomUUID()}`;
// UI letters are intentionally separate from the preserved upstream backend keys.
const engines = [
  { key: "grid", letter: "A", name: "Face Grid", caption: "얼굴 격자" },
  { key: "A", letter: "B", name: "Cloak", caption: "미세 노이즈" },
  { key: "B", letter: "C", name: "Frequency", caption: "주파수 변형" },
  { key: "C", letter: "D", name: "Semantic", caption: "그레인·워프" },
] as const;
function Range({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit = "",
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  unit?: string;
  disabled?: boolean;
}) {
  return (
    <div className="cloak-range">
      <div>
        <label>{label}</label>
        <span>
          <input
            aria-label={label}
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value !== "")
                onChange(clamp(Number(e.target.value), min, max));
            }}
          />
          {unit}
        </span>
      </div>
      <Slider
        aria-label={`${label} 슬라이더`}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}
function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="cloak-toggle">
      <div>
        <span>{label}</span>
        {hint && <p>{hint}</p>}
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}
export function CloakWorkspace({
  active,
  runtime,
  prefs,
  savePreferences,
  externalBusy,
  onBusyChange,
  tutorialOpen,
  onTutorialClose,
  onTutorialOpen,
  onOpenSettings,
}: Props) {
  const [items, setItems] = useState<Media[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [time, setTime] = useState(0);
  const [preview, setPreview] = useState<CloakPreviewResult | null>(null);
  const [view, setView] = useState<"result" | "source" | "compare">("result");
  const [split, setSplit] = useState(50);
  const [previewing, setPreviewing] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [probing, setProbing] = useState(false);
  const [progress, setProgress] = useState<CloakProgressEvent | null>(null);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [manualDragging, setManualDragging] = useState(false);
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const hovering = useRef(false);
  const dragDepth = useRef(0);
  const job = useRef<string | null>(null);
  const previewJob = useRef<string | null>(null);
  const generation = useRef(0);
  const previewQueue = useRef<Promise<void>>(Promise.resolve());
  const firstFace = useRef(false);
  const skipPreview = useRef("");
  const seekChange = useRef(false);
  const selected = items.find((i) => i.path === selectedPath) ?? items[0];
  const options = prefs.cloakOptions ?? defaultCloakOptions;
  const optionKey = JSON.stringify(options);
  const ready = !!runtime.cloakReady && !isBrowserDemo;
  const locked = rendering || externalBusy;
  const patch = useCallback(
    (change: Partial<CloakOptions>) =>
      savePreferences({ cloakOptions: { ...options, ...change } }),
    [options, savePreferences],
  );
  const grid = (change: Partial<CloakOptions["grid"]>) =>
    patch({ grid: { ...options.grid, ...change } });
  const fail = (e: unknown) => setError(message(e));
  const stopPreview = useCallback(() => {
    const stoppedGeneration = ++generation.current;
    const current = previewJob.current;
    if (current)
      void api
        .cancelCloakJob(current)
        .catch(() => {})
        .finally(() => {
          void previewQueue.current.finally(() => {
            if (generation.current === stoppedGeneration) setPreviewing(false);
          });
        });
    else setPreviewing(false);
  }, []);

  useEffect(() => {
    onBusyChange(rendering || previewing);
    return () => onBusyChange(false);
  }, [rendering, previewing, onBusyChange]);
  useEffect(() => {
    if (!active) stopPreview();
  }, [active, stopPreview]);
  useEffect(
    () =>
      api.onCloakProgress((event) => {
        if (event.jobId === job.current) {
          setProgress(event);
          if (event.outputPath)
            setOutputs((previous) =>
              previous.includes(event.outputPath!)
                ? previous
                : [...previous, event.outputPath!],
            );
        }
      }),
    [],
  );
  useEffect(
    () => () => {
      generation.current++;
      if (previewJob.current)
        void api.cancelCloakJob(previewJob.current).catch(() => {});
    },
    [],
  );

  const select = useCallback(
    (item: Media) => {
      stopPreview();
      setSelectedPath(item.path);
      setTime(0);
      setPreview(null);
      setError("");
      firstFace.current =
        item.kind === "video" &&
        (options.tracking || Object.values(options.methods).some(Boolean));
    },
    [stopPreview, options.tracking, options.methods],
  );
  const addFiles = useCallback(
    async (paths: string[]) => {
      if (!paths.length || rendering) return;
      setProbing(true);
      setError("");
      const loaded: Media[] = [];
      const errors: string[] = [];
      for (const path of [...new Set(paths)]) {
        try {
          loaded.push(await api.cloakProbe(path));
        } catch (e) {
          errors.push(message(e));
        }
      }
      if (loaded.length) {
        setItems((previous) => {
          const seen = new Set(previous.map((i) => i.path));
          return [...previous, ...loaded.filter((i) => !seen.has(i.path))];
        });
        if (!selected) select(loaded[0]);
        setOutputs([]);
      }
      if (errors.length) setError(errors.join("\n"));
      setProbing(false);
    },
    [rendering, selected, select],
  );
  const choose = () => void api.chooseCloakFiles().then(addFiles).catch(fail);
  useEffect(() => {
    const paste = (event: KeyboardEvent) => {
      if (
        !active ||
        rendering ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "v"
      )
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input,textarea,[contenteditable="true"]')) return;
      if (!hovering.current && !root.current?.contains(document.activeElement))
        return;
      event.preventDefault();
      void api
        .pasteClipboardImage()
        .then((path) =>
          path ? addFiles([path]) : setNotice("클립보드에 이미지가 없습니다."),
        )
        .catch(fail);
    };
    const keys = (event: KeyboardEvent) => {
      if (
        !active ||
        locked ||
        selected?.kind !== "video" ||
        (event.target as HTMLElement)?.closest(
          'input,textarea,[role="slider"],[role="combobox"],[contenteditable="true"]',
        )
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        seekChange.current = true;
        setTime((t) =>
          clamp(
            t + (event.key === "ArrowRight" ? 1 : -1) / selected.fps,
            0,
            Math.max(0, (selected.frames - 1) / selected.fps),
          ),
        );
      }
    };
    window.addEventListener("keydown", paste);
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("keydown", paste);
      window.removeEventListener("keydown", keys);
    };
  }, [active, rendering, locked, selected, addFiles]);

  useEffect(() => {
    if (!active || !selected || !ready || locked) return;
    const signature = `${selected.path}|${time}|${optionKey}`;
    if (skipPreview.current === signature) {
      skipPreview.current = "";
      return;
    }
    const sequence = ++generation.current;
    const delay = seekChange.current ? 60 : 220;
    seekChange.current = false;
    if (previewJob.current)
      void api.cancelCloakJob(previewJob.current).catch(() => {});
    const timer = setTimeout(() => {
      setPreviewing(true);
      previewQueue.current = previewQueue.current
        .catch(() => {})
        .then(async () => {
          if (sequence !== generation.current) return;
          const id = uid();
          previewJob.current = id;
          const findFace = firstFace.current;
          firstFace.current = false;
          try {
            const result = await api.cloakPreview({
              jobId: id,
              path: selected.path,
              time,
              options,
              findFace,
            });
            if (sequence !== generation.current) return;
            setPreview(result);
            setError("");
            if (findFace && selected.kind === "video") {
              const next = clamp(
                result.frame / selected.fps,
                0,
                Math.max(0, (selected.frames - 1) / selected.fps),
              );
              if (Math.abs(next - time) > 0.001) {
                skipPreview.current = `${selected.path}|${next}|${optionKey}`;
                setTime(next);
              }
            }
          } catch (e) {
            if (
              sequence === generation.current &&
              !/cancel|취소/i.test(message(e))
            )
              setError(message(e));
          } finally {
            if (previewJob.current === id) previewJob.current = null;
            if (sequence === generation.current) setPreviewing(false);
          }
        });
    }, delay);
    return () => clearTimeout(timer);
    // Options are represented by their stable serialized value, not an IPC preference object identity.
  }, [active, selected?.path, time, optionKey, ready, locked, refresh]);

  const changeTime = (value: number) => {
    seekChange.current = true;
    firstFace.current = false;
    setTime(value);
  };
  const chooseDirectory = async () => {
    try {
      const path = await api.chooseCloakOutputDir();
      if (path) savePreferences({ cloakOutputDir: path });
    } catch (e) {
      fail(e);
    }
  };
  const defaultOutput = (item: Media, dir: string, index = 0) => {
    const stem = item.name.replace(/\.[^.]+$/, "");
    const ext =
      item.kind === "video"
        ? "mp4"
        : (/\.(png|jpe?g|webp|bmp|tiff?)$/i.exec(item.name)?.[1] ?? "png");
    const suffix = index > 0 ? `_${index + 1}` : "";
    return `${dir.replace(/[\\/]$/, "")}/${stem}_cloaked${suffix}.${ext}`;
  };
  const render = async (saveAs = false) => {
    if (!items.length || !ready || locked) return;
    setError("");
    setNotice("");
    let dir = prefs.cloakOutputDir;
    let paths: { path: string; outputPath: string }[] = [];
    try {
      if (saveAs && items.length === 1) {
        const output = await api.chooseCloakSavePath(
          defaultOutput(
            items[0],
            dir || items[0].path.replace(/[\\/][^\\/]*$/, ""),
          ),
        );
        if (!output) return;
        paths = [{ path: items[0].path, outputPath: output }];
        const slash = Math.max(
          output.lastIndexOf("/"),
          output.lastIndexOf("\\"),
        );
        if (slash >= 0)
          savePreferences({ cloakOutputDir: output.slice(0, slash) });
      } else {
        if (!dir) {
          const chosen = await api.chooseCloakOutputDir();
          if (!chosen) return;
          dir = chosen;
          savePreferences({ cloakOutputDir: dir });
        }
        const names = new Map<string, number>();
        paths = items.map((item) => {
          const name = item.name.replace(/\.[^.]+$/, "").toLowerCase();
          const count = names.get(name) ?? 0;
          names.set(name, count + 1);
          return {
            path: item.path,
            outputPath: defaultOutput(item, dir, count),
          };
        });
      }
      stopPreview();
      await previewQueue.current.catch(() => {});
      setRendering(true);
      setOutputs([]);
      const id = uid();
      job.current = id;
      setProgress({
        jobId: id,
        stage: "starting",
        progress: 0,
        message: "내보내기를 준비하고 있습니다.",
      });
      const result = await api.cloakRender({ jobId: id, jobs: paths, options });
      setOutputs(result.outputs);
      setNotice(
        `${result.outputs.length}개 파일 저장 완료 · ${result.elapsed.toFixed(1)}초`,
      );
    } catch (e) {
      if (/cancel|취소/i.test(message(e)))
        setNotice(
          "작업이 취소되었습니다. 완료된 파일은 저장 폴더에서 확인하세요.",
        );
      else fail(e);
    } finally {
      job.current = null;
      setRendering(false);
    }
  };
  const cancel = () => {
    if (job.current) void api.cancelCloakJob(job.current).catch(fail);
  };
  const source =
    preview?.source ||
    selected?.thumbnail ||
    (selected?.kind === "image" ? selected.path : "");
  const processed =
    rendering && progress?.preview ? progress.preview : preview?.image;
  const manual = options.use_grid && !options.tracking && !locked;
  const moveManual = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!manual || !stage.current || !selected) return;
    const rect = stage.current.getBoundingClientRect();
    const ratio = selected.width / selected.height;
    const width = Math.min(rect.width, rect.height * ratio);
    const height = width / ratio;
    const x0 = rect.left + (rect.width - width) / 2;
    const y0 = rect.top + (rect.height - height) / 2;
    if (
      !manualDragging &&
      (event.clientX < x0 ||
        event.clientX > x0 + width ||
        event.clientY < y0 ||
        event.clientY > y0 + height)
    )
      return;
    patch({
      man_cx: Math.round(clamp((event.clientX - x0) / width) * 100) / 100,
      man_cy: Math.round(clamp((event.clientY - y0) / height) * 100) / 100,
    });
  };
  const gridColor = `#${[...options.grid.color]
    .reverse()
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
  return (
    <main
      ref={root}
      className="workspace cloak-workspace"
      style={{ display: active ? undefined : "none" }}
      tabIndex={-1}
      aria-label="MagiCloak 작업실"
      onMouseEnter={() => (hovering.current = true)}
      onMouseLeave={() => (hovering.current = false)}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.types.includes("Files")) {
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current--;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        void addFiles(
          Array.from(e.dataTransfer.files).map((file) => api.getFilePath(file)),
        );
      }}
    >
      <section className="editor-column cloak-editor">
        <div className="workspace-heading">
          <div>
            <div className="eyebrow">MAGICLOAK / THE ALTERATION ROOM</div>
            <h1>MagiCloak</h1>
            <p>
              격자와 미세 변형을 한 번에. 매지코의 장난을 직접 조절해 보세요.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={choose}
            disabled={rendering || probing}
          >
            {probing ? <Loader2 className="animate-spin" /> : <Plus />}파일 추가
          </Button>
        </div>
        {isBrowserDemo && (
          <div className="demo-notice">
            <Info size={13} />
            브라우저 디자인 미리보기 · 실제 처리는 데스크톱 앱에서 실행됩니다.
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button aria-label="Cloak 오류 닫기" onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}
        {!ready && !isBrowserDemo && (
          <div className="cloak-install">
            <div>
              <Download size={18} />
              <span>
                <strong>
                  {runtime.installing
                    ? "마법 도구를 준비하고 있어요."
                    : "MagiCloak 실행 환경이 필요합니다."}
                </strong>
                <small>
                  {runtime.error ||
                    runtime.message ||
                    "가벼운 이미지·영상 도구를 설치합니다. 대형 AI 모델은 필요 없습니다."}
                </small>
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={runtime.installing}
              onClick={() => void api.installRuntime("cloak").catch(fail)}
            >
              {runtime.installing
                ? `${Math.round(runtime.progress * 100)}%`
                : "도구 준비"}
            </Button>
          </div>
        )}
        <div className="cloak-preview-panel">
          <div className="cloak-preview-toolbar">
            <div>
              <span className="tiny-dot" />
              <span>{selected?.name ?? "PREVIEW STUDIO"}</span>
            </div>
            <div
              className="cloak-view-switch"
              role="group"
              aria-label="Cloak 미리보기 모드"
            >
              {(["source", "result", "compare"] as const).map((mode) => (
                <button
                  key={mode}
                  aria-pressed={view === mode}
                  disabled={!selected}
                  onClick={() => setView(mode)}
                >
                  {mode === "source"
                    ? "원본"
                    : mode === "result"
                      ? "결과"
                      : "비교"}
                </button>
              ))}
            </div>
          </div>
          <div
            ref={stage}
            className={cn("cloak-stage", manual && "manual-grid")}
            tabIndex={0}
            aria-label="Cloak 파일 드롭 및 미리보기 영역"
            onPointerDown={(e) => {
              if (manual && selected) {
                moveManual(e);
                setManualDragging(true);
                e.currentTarget.setPointerCapture(e.pointerId);
              }
            }}
            onPointerMove={(e) => {
              if (manualDragging) moveManual(e);
            }}
            onPointerUp={() => setManualDragging(false)}
            onPointerCancel={() => setManualDragging(false)}
          >
            {!selected ? (
              <div className="cloak-empty">
                <div className="cloak-orb">
                  <div className="cloak-orb-grid" />
                  <ScanFace size={45} strokeWidth={1.15} />
                  <span>A</span>
                </div>
                <div className="eyebrow">A LITTLE MISCHIEF, ALL LOCAL.</div>
                <h2>매지코의 마법을 느껴보세요</h2>
                <p>
                  이미지와 영상을 여기에 놓아보세요.
                  <br />
                  여러 개도 괜찮아요. 주문은 한 번이면 됩니다.
                </p>
                <Button onClick={choose} disabled={probing}>
                  <Upload size={15} />
                  파일 골라오기
                </Button>
                <span className="cloak-paste-hint">
                  PNG · JPG · WEBP · MP4 · MOV 외 <i /> 이미지 붙여넣기{" "}
                  <kbd>Ctrl V</kbd>
                </span>
                <button className="cloak-guide-link" onClick={onTutorialOpen}>
                  <BookOpen size={13} />
                  어떤 마법인지 궁금하다면
                </button>
              </div>
            ) : (
              <>
                {source ? (
                  <img
                    className="cloak-source"
                    src={mediaUrl(
                      view === "result" && processed ? processed : source,
                    )}
                    alt={
                      view === "result" && processed
                        ? "Cloak 처리 결과"
                        : "원본 프레임"
                    }
                    draggable={false}
                  />
                ) : (
                  <div className="cloak-await">
                    <Film size={32} />
                    <p>
                      {previewing
                        ? "첫 프레임을 불러오는 중…"
                        : "프레임 미리보기를 준비하세요."}
                    </p>
                  </div>
                )}
                {view === "compare" && processed && (
                  <>
                    <img
                      className="cloak-comparison"
                      src={mediaUrl(processed)}
                      alt="비교용 Cloak 처리 결과"
                      style={{ clipPath: `inset(0 0 0 ${split}%)` }}
                      draggable={false}
                    />
                    <div
                      className="cloak-split-line"
                      style={{ left: `${split}%` }}
                    >
                      <span>
                        <ChevronLeft size={11} />
                        <ChevronRight size={11} />
                      </span>
                    </div>
                    <input
                      className="cloak-split-control"
                      type="range"
                      min="0"
                      max="100"
                      value={split}
                      aria-label="Cloak 원본 결과 비교 위치"
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) => setSplit(Number(e.target.value))}
                    />
                    <span className="cloak-image-label source">원본</span>
                    <span className="cloak-image-label result">Cloak</span>
                  </>
                )}
                {previewing && (
                  <div className="cloak-processing">
                    <Loader2 size={13} className="animate-spin" />
                    프레임 갱신 중
                  </div>
                )}
                {manual && view !== "compare" && (
                  <div className="cloak-manual-hint">
                    <MousePointer2 size={12} />
                    이미지 위를 드래그하여 격자 이동
                  </div>
                )}
                {selected && !processed && !previewing && (
                  <span className="cloak-image-label source">
                    원본 · 처리 결과 대기
                  </span>
                )}
              </>
            )}
          </div>
          <div className="cloak-preview-footer">
            <div>
              {selected ? (
                <>
                  <span>
                    {selected.width} × {selected.height}
                  </span>
                  <i />
                  {selected.kind === "video" ? (
                    <span>
                      {selected.fps.toFixed(2)} fps ·{" "}
                      {seconds(selected.duration)}
                    </span>
                  ) : (
                    <span>STILL IMAGE</span>
                  )}
                </>
              ) : (
                <span>최대 960px 미리보기 · 원본 해상도로 내보내기</span>
              )}
            </div>
            <span>
              {preview
                ? `${preview.detector} · 얼굴 ${preview.faceCount}개 · ${preview.elapsed.toFixed(2)}s`
                : "LOCAL PROCESSING"}
            </span>
          </div>
        </div>
        {selected && (
          <div className="cloak-timeline">
            <div className="cloak-frame-row">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Cloak 이전 프레임"
                  disabled={selected.kind === "image" || locked || time === 0}
                  onClick={() =>
                    changeTime(Math.max(0, time - 1 / selected.fps))
                  }
                >
                  <ChevronLeft />
                </Button>
                <span className="cloak-frame-time">
                  {selected.kind === "video" ? seconds(time) : "정지 이미지"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Cloak 다음 프레임"
                  disabled={
                    selected.kind === "image" ||
                    locked ||
                    time >= (selected.frames - 1) / selected.fps
                  }
                  onClick={() =>
                    changeTime(
                      Math.min(
                        (selected.frames - 1) / selected.fps,
                        time + 1 / selected.fps,
                      ),
                    )
                  }
                >
                  <ChevronRight />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                {selected.kind === "video" && (
                  <Tooltip label="최대 14개 구간에서 얼굴이 있는 프레임을 탐색합니다.">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!ready || locked}
                      onClick={() => {
                        firstFace.current = true;
                        setRefresh((v) => v + 1);
                      }}
                    >
                      <ScanFace />
                      얼굴 프레임 찾기
                    </Button>
                  </Tooltip>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!ready || locked}
                  onClick={() => setRefresh((v) => v + 1)}
                >
                  <RefreshCw className={previewing ? "animate-spin" : ""} />
                  미리보기
                </Button>
              </div>
            </div>
            {selected.kind === "video" && (
              <>
                <Slider
                  aria-label="Cloak 영상 프레임 위치"
                  min={0}
                  max={Math.max(
                    1 / selected.fps,
                    (selected.frames - 1) / selected.fps,
                  )}
                  step={1 / selected.fps}
                  value={[time]}
                  disabled={locked}
                  onValueChange={(v) => changeTime(v[0])}
                />
                <div className="cloak-timeline-labels">
                  <span>00:00.00</span>
                  <span>
                    {Math.round(time * selected.fps) + 1} / {selected.frames}{" "}
                    FRAME
                  </span>
                  <span>{seconds(selected.duration)}</span>
                </div>
              </>
            )}
          </div>
        )}
        {preview && options.tracking && preview.faceCount === 0 && (
          <div className="cloak-hint warning">
            <Info size={14} />
            <span>
              이 프레임에서 얼굴이 검출되지 않았습니다. 얼굴 프레임 찾기 또는
              수동 격자를 사용하세요. 인물 이외의 얼굴은 검출되지 않을 수
              있습니다.
            </span>
          </div>
        )}
        {items.length > 0 && (
          <section className="cloak-queue" aria-label="Cloak 일괄 파일 목록">
            <div className="cloak-section-heading">
              <span>
                <Files size={14} />
                주문 목록 <b>{items.length}</b>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={rendering}
                onClick={() => {
                  stopPreview();
                  setItems([]);
                  setSelectedPath("");
                  setPreview(null);
                  setOutputs([]);
                }}
              >
                <Trash2 />
                비우기
              </Button>
            </div>
            <div className="cloak-file-strip">
              {items.map((item, index) => (
                <div
                  className={cn(
                    "cloak-file-card",
                    selected?.path === item.path && "selected",
                  )}
                  key={item.path}
                >
                  <button
                    className="cloak-file-select"
                    aria-label={`${item.name} 미리보기`}
                    disabled={rendering}
                    onClick={() => select(item)}
                  >
                    <div className="cloak-file-thumbnail">
                      {item.thumbnail ? (
                        <img src={mediaUrl(item.thumbnail)} alt="" />
                      ) : item.kind === "video" ? (
                        <Film size={23} />
                      ) : (
                        <ImageIcon size={23} />
                      )}
                      <span>{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <strong title={item.name}>{item.name}</strong>
                    <small>
                      {item.kind === "image" ? "IMAGE" : seconds(item.duration)}
                    </small>
                  </button>
                  <button
                    className="cloak-file-remove"
                    aria-label={`${item.name} 제거`}
                    disabled={rendering}
                    onClick={() => {
                      setItems(items.filter((i) => i.path !== item.path));
                      if (selected?.path === item.path) {
                        const next = items.find((i) => i.path !== item.path);
                        if (next) select(next);
                        else {
                          stopPreview();
                          setSelectedPath("");
                          setPreview(null);
                        }
                      }
                    }}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              <button
                className="cloak-add-card"
                onClick={choose}
                disabled={rendering || probing}
                aria-label="Cloak 파일 더 추가"
              >
                <Plus size={22} />
                <span>더 넣기</span>
              </button>
            </div>
          </section>
        )}
        <div className="cloak-bottom-note">
          <ShieldCheck size={13} />
          <span>
            내 컴퓨터 안에서 처리합니다. 인식 차단·익명화 효과는 보장하지
            않습니다.
          </span>
          <button onClick={onTutorialOpen}>
            사용 가이드 <ChevronRight size={12} />
          </button>
        </div>
      </section>
      <aside className="cloak-settings">
        <div className="cloak-settings-title">
          <div>
            <SlidersHorizontal size={15} />
            <h2>주문 조합</h2>
          </div>
          <Tooltip label="Cloak 설정 초기화">
            <Button
              variant="ghost"
              size="icon"
              disabled={locked}
              aria-label="Cloak 설정 초기화"
              onClick={() =>
                savePreferences({
                  cloakOptions: structuredClone(defaultCloakOptions),
                })
              }
            >
              <RotateCcw size={14} />
            </Button>
          </Tooltip>
        </div>
        <div className="cloak-settings-scroll">
          <fieldset disabled={locked}>
            <section className="cloak-settings-section">
              <div className="cloak-label">
                ENGINES <span>원하는 효과만 골라보세요</span>
              </div>
              <div className="cloak-engine-grid">
                {engines.map(({ key, letter, name, caption }) => (
                  <button
                    key={key}
                    aria-pressed={
                      key === "grid" ? options.use_grid : options.methods[key]
                    }
                    onClick={() =>
                      key === "grid"
                        ? patch({ use_grid: !options.use_grid })
                        : patch({
                            methods: {
                              ...options.methods,
                              [key]: !options.methods[key],
                            },
                          })
                    }
                    className={cn(
                      "cloak-engine-card",
                      (key === "grid"
                        ? options.use_grid
                        : options.methods[key]) && "enabled",
                    )}
                  >
                    <span>
                      {letter}
                      <i />
                    </span>
                    <strong>{name}</strong>
                    <small>{caption}</small>
                  </button>
                ))}
              </div>
              {Object.values(options.methods).some(Boolean) && (
                <div className="cloak-experimental-warning" role="note">
                  <TriangleAlert size={13} aria-hidden="true" />
                  <span>
                    이 기능은 실험적 기능이며, 적용효과가 없을 수 있습니다.
                  </span>
                </div>
              )}
              {options.methods.A && (
                <Range
                  label="B · 노이즈 강도"
                  value={options.eps}
                  min={2}
                  max={30}
                  onChange={(eps) => patch({ eps })}
                />
              )}
              {(options.methods.B || options.methods.C) && (
                <Range
                  label="C / D · 변형 강도"
                  value={options.strength}
                  min={0.01}
                  max={0.2}
                  step={0.01}
                  onChange={(strength) => patch({ strength })}
                />
              )}
              {!options.use_grid &&
                !Object.values(options.methods).some(Boolean) && (
                  <p className="cloak-control-note">
                    활성 효과가 없습니다. 형식·품질 변환만 적용됩니다.
                  </p>
                )}
            </section>
            <section className="cloak-settings-section">
              <div className="cloak-label">
                DETECTION <ScanFace size={13} />
              </div>
              <Toggle
                label="자동 얼굴 검출 · 추적"
                hint="끄면 격자 수동 배치 · B/C/D 얼굴 영역은 별도 검출"
                checked={options.tracking}
                onChange={(tracking) => patch({ tracking })}
              />
              <div className="cloak-detector-state">
                <span className="tiny-dot" />
                {preview
                  ? `${preview.detector} · ${preview.faceCount} faces`
                  : "YuNet → res10 → Haar fallback"}
                <Tooltip label="설치된 검출기 상태에 따라 선택됩니다. 특정 인물이나 비인간 캐릭터의 얼굴 검출을 보장하지 않습니다.">
                  <Info size={12} />
                </Tooltip>
              </div>
            </section>
            {options.use_grid && (
              <section className="cloak-settings-section">
                <div className="cloak-label">
                  FACE GRID <span>A</span>
                </div>
                <div className="cloak-dual">
                  <Range
                    label="행"
                    value={options.grid.rows}
                    min={1}
                    max={20}
                    onChange={(rows) => grid({ rows })}
                  />
                  <Range
                    label="열"
                    value={options.grid.cols}
                    min={1}
                    max={20}
                    onChange={(cols) => grid({ cols })}
                  />
                </div>
                <Range
                  label="격자 불투명도"
                  value={options.grid.opacity}
                  min={0.05}
                  max={1}
                  step={0.01}
                  onChange={(opacity) => grid({ opacity })}
                />
                <div className="cloak-dual cloak-grid-style">
                  <div>
                    <label className="cloak-field-label">격자 모양</label>
                    <Select
                      label="격자 모양"
                      value={options.grid.shape}
                      onValueChange={(shape) =>
                        grid({ shape: shape as "ellipse" | "rect" })
                      }
                    >
                      <SelectItem value="ellipse">타원</SelectItem>
                      <SelectItem value="rect">사각형</SelectItem>
                    </Select>
                  </div>
                  <label className="cloak-color">
                    <span className="cloak-field-label">격자 색상</span>
                    <span>
                      <input
                        type="color"
                        aria-label="격자 색상"
                        value={gridColor}
                        onChange={(e) => {
                          const hex = e.target.value;
                          grid({
                            color: [
                              parseInt(hex.slice(5, 7), 16),
                              parseInt(hex.slice(3, 5), 16),
                              parseInt(hex.slice(1, 3), 16),
                            ],
                          });
                        }}
                      />
                      <code>{gridColor.toUpperCase()}</code>
                    </span>
                  </label>
                </div>
                <Toggle
                  label="얼굴 각도에 맞추기"
                  checked={options.grid.align_angle}
                  onChange={(align_angle) => grid({ align_angle })}
                />
                <Toggle
                  label="선 두께 자동 조절"
                  checked={options.grid.auto_thickness}
                  onChange={(auto_thickness) => grid({ auto_thickness })}
                />
                {!options.grid.auto_thickness && (
                  <Range
                    label="선 두께"
                    unit="px"
                    value={options.grid.thickness}
                    min={1}
                    max={8}
                    onChange={(thickness) => grid({ thickness })}
                  />
                )}
                <details className="cloak-details">
                  <summary>
                    격자 세부 설정
                    <ChevronDown size={13} />
                  </summary>
                  <Range
                    label="얼굴 영역 여백"
                    value={options.grid.margin}
                    min={0}
                    max={0.4}
                    step={0.01}
                    onChange={(margin) => grid({ margin })}
                  />
                  <Toggle
                    label="교차점 표시"
                    checked={options.grid.dots}
                    onChange={(dots) => grid({ dots })}
                  />
                  {options.grid.dots && (
                    <Range
                      label="교차점 반경"
                      unit="px"
                      value={options.grid.dot_radius}
                      min={1}
                      max={8}
                      onChange={(dot_radius) => grid({ dot_radius })}
                    />
                  )}
                  <Toggle
                    label="매끄러운 선 · Anti-aliasing"
                    checked={options.grid.line_aa}
                    onChange={(line_aa) => grid({ line_aa })}
                  />
                </details>
                {!options.tracking && (
                  <div className="cloak-manual-controls">
                    <div className="cloak-manual-title">
                      <MousePointer2 size={13} />
                      수동 위치 · 미리보기에서 드래그
                    </div>
                    <div className="cloak-dual">
                      <Range
                        label="가로 위치"
                        value={options.man_cx}
                        min={0}
                        max={1}
                        step={0.01}
                        onChange={(man_cx) => patch({ man_cx })}
                      />
                      <Range
                        label="세로 위치"
                        value={options.man_cy}
                        min={0}
                        max={1}
                        step={0.01}
                        onChange={(man_cy) => patch({ man_cy })}
                      />
                      <Range
                        label="격자 너비"
                        value={options.man_w}
                        min={0.05}
                        max={1}
                        step={0.01}
                        onChange={(man_w) => patch({ man_w })}
                      />
                      <Range
                        label="격자 높이"
                        value={options.man_h}
                        min={0.05}
                        max={1}
                        step={0.01}
                        onChange={(man_h) => patch({ man_h })}
                      />
                    </div>
                    <p className="cloak-control-note">
                      모든 프레임에 같은 정규화 위치를 적용합니다. 비교
                      모드에서는 슬라이더로 위치를 조절하세요.
                    </p>
                  </div>
                )}
              </section>
            )}
            <section className="cloak-settings-section">
              <div className="cloak-label">
                OUTPUT <span>원본 해상도</span>
              </div>
              <label className="cloak-field-label">내보내기 품질</label>
              <Select
                label="Cloak 내보내기 품질"
                value={options.quality}
                onValueChange={(quality) =>
                  patch({ quality: quality as CloakQuality })
                }
              >
                {Object.entries(qualityInfo).map(([key, value]) => (
                  <SelectItem key={key} value={key}>
                    {value.label}
                  </SelectItem>
                ))}
              </Select>
              <p className="cloak-control-note">
                {qualityInfo[options.quality].detail}
              </p>
              <div className="cloak-audio-note">
                <Volume2 size={13} />
                <span>
                  영상 오디오는 가능한 경우 유지 · 이미지는 원본 확장자
                </span>
              </div>
              <Toggle
                label="짧은 영상 검정 패딩"
                hint="목표 길이보다 짧을 때 검정 화면·무음 추가"
                checked={options.pad_enabled}
                onChange={(pad_enabled) => patch({ pad_enabled })}
              />
              {options.pad_enabled && (
                <>
                  <div className="mt-3">
                    <label className="cloak-field-label">검정 패딩 위치</label>
                    <Select
                      label="검정 패딩 위치"
                      value={options.pad_position ?? "after"}
                      onValueChange={(pad_position) =>
                        patch({
                          pad_position: pad_position as "before" | "after",
                        })
                      }
                    >
                      <SelectItem value="before">영상 앞 · Front</SelectItem>
                      <SelectItem value="after">영상 뒤 · Back</SelectItem>
                    </Select>
                  </div>
                  <Range
                    label="최소 영상 길이"
                    unit="s"
                    value={options.pad_seconds}
                    min={1}
                    max={15}
                    step={0.5}
                    onChange={(pad_seconds) => patch({ pad_seconds })}
                  />
                </>
              )}
              <p className="cloak-control-note">
                이미지에는 패딩이 적용되지 않습니다. PNG는 손실 없는 이미지
                인코딩을 사용합니다.
              </p>
            </section>
            <details className="cloak-details cloak-advanced">
              <summary>
                고급 검출 설정
                <ChevronDown size={13} />
              </summary>
              <Range
                label="검출 신뢰도 기준"
                value={options.detect_score}
                min={0.1}
                max={0.95}
                step={0.05}
                onChange={(detect_score) => patch({ detect_score })}
              />
              <label className="cloak-field-label">B / C / D 적용 영역</label>
              <Select
                label="변형 적용 영역 모양"
                value={options.roi_shape}
                onValueChange={(roi_shape) =>
                  patch({ roi_shape: roi_shape as "ellipse" | "rect" })
                }
              >
                <SelectItem value="ellipse">타원</SelectItem>
                <SelectItem value="rect">사각형</SelectItem>
              </Select>
              <p className="cloak-control-note">
                검출기별 신뢰도 해석은 다를 수 있습니다. 이 효과는 학습된 공격
                모델이나 익명화 도구가 아닙니다.
              </p>
            </details>
          </fieldset>
        </div>
        <div className="cloak-export">
          <label className="cloak-field-label">
            저장 폴더 <span>다음에도 기억해요</span>
          </label>
          <div className="cloak-output-path">
            <button
              disabled={rendering}
              title={prefs.cloakOutputDir || "저장 폴더 선택"}
              onClick={() => void chooseDirectory()}
            >
              <FolderOpen size={14} />
              <span>{prefs.cloakOutputDir || "저장 폴더 선택"}</span>
              <ChevronRight size={13} />
            </button>
            {prefs.cloakOutputDir && (
              <Tooltip label="저장 폴더 열기">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Cloak 저장 폴더 열기"
                  onClick={() =>
                    void api.openFolder(prefs.cloakOutputDir).catch(fail)
                  }
                >
                  <FolderOpen size={14} />
                </Button>
              </Tooltip>
            )}
          </div>
          {rendering && progress && (
            <div className="cloak-render-progress" role="status">
              <div>
                <span>{progress.message}</span>
                <b>{Math.round(clamp(progress.progress) * 100)}%</b>
              </div>
              <div className="cloak-progress-track">
                <i style={{ width: `${clamp(progress.progress) * 100}%` }} />
              </div>
              <small>
                {progress.fileIndex != null
                  ? `${progress.fileIndex + 1} / ${progress.totalFiles ?? items.length} 파일`
                  : ""}
                {progress.frame != null
                  ? ` · ${progress.frame} / ${progress.totalFrames ?? "—"} 프레임`
                  : ""}
                {progress.fps ? ` · ${progress.fps.toFixed(1)} fps` : ""}
              </small>
            </div>
          )}
          {notice && (
            <div className="cloak-notice" role="status">
              <CheckCircle2 size={13} />
              <span>{notice}</span>
              <button
                aria-label="Cloak 안내 닫기"
                onClick={() => setNotice("")}
              >
                <X size={12} />
              </button>
            </div>
          )}
          <div className="cloak-export-actions">
            {rendering ? (
              <Button variant="outline" className="w-full" onClick={cancel}>
                <Square size={13} />
                작업 취소
              </Button>
            ) : (
              <>
                <Button
                  className="flex-1"
                  disabled={!items.length || !ready || externalBusy || probing}
                  onClick={() => void render()}
                >
                  <ArrowDownToLine />
                  {items.length > 1
                    ? `${items.length}개 일괄 내보내기`
                    : "Cloak 내보내기"}
                </Button>
                <Tooltip label="한 파일을 다른 이름으로 저장">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Cloak 다른 이름으로 저장"
                    disabled={
                      items.length !== 1 || !ready || externalBusy || probing
                    }
                    onClick={() => void render(true)}
                  >
                    <Save size={16} />
                  </Button>
                </Tooltip>
              </>
            )}
          </div>
          {outputs.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-2"
              onClick={() => void api.revealFile(outputs[0]).catch(fail)}
            >
              <FolderOpen />
              저장된 결과 보기 · {outputs.length}개
            </Button>
          )}
          <p className="cloak-export-footnote">
            {externalBusy
              ? "MagiDepth 작업이 끝나면 실행할 수 있습니다."
              : !ready
                ? "실행 환경을 준비하면 미리보기와 저장이 활성화됩니다."
                : "원본은 그대로 · 같은 이름의 기존 파일은 덮어쓰지 않습니다."}
          </p>
        </div>
      </aside>
      {dragging && (
        <div className="drop-overlay cloak-drop">
          <div>
            <Upload size={40} strokeWidth={1.2} />
            <h2>매지코에게 맡겨보세요.</h2>
            <p>이미지·영상 여러 개를 한 번에 추가합니다.</p>
          </div>
        </div>
      )}
      <CloakTutorial open={tutorialOpen} onClose={onTutorialClose} />
    </main>
  );
}
