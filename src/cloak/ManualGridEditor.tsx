import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { MousePointer2, Plus, Trash2 } from "lucide-react";
import type { CloakOptions } from "../../shared/contracts";
import { Button } from "../components/ui/button";
import "./manual-grid.css";

export type ManualGrid = {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
};
const limit = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const precision = (value: number) => Math.round(value * 10000) / 10000;
export function constrainGrid(grid: ManualGrid): ManualGrid {
  const w = limit(Number.isFinite(grid.w)?grid.w:.35, 0.05, 1),
    h = limit(Number.isFinite(grid.h)?grid.h:.45, 0.05, 1);
  return {
    ...grid,
    w: precision(w),
    h: precision(h),
    cx: precision(limit(Number.isFinite(grid.cx)?grid.cx:.5, w / 2, 1 - w / 2)),
    cy: precision(limit(Number.isFinite(grid.cy)?grid.cy:.5, h / 2, 1 - h / 2)),
  };
}
export function readManualGrids(options: CloakOptions): ManualGrid[] {
  return (
    options.manual_grids ?? [
      {
        id: "legacy-grid",
        cx: options.man_cx,
        cy: options.man_cy,
        w: options.man_w,
        h: options.man_h,
      },
    ]
  )
    .slice(0, 16)
    .map(constrainGrid);
}
type Corner = "nw" | "ne" | "sw" | "se";
const cornerLabels: Record<Corner, string> = {
  nw: "왼쪽 위",
  ne: "오른쪽 위",
  sw: "왼쪽 아래",
  se: "오른쪽 아래",
};
function resizeGrid(
  grid: ManualGrid,
  corner: Corner,
  x: number,
  y: number,
): ManualGrid {
  const west = corner.includes("w"),
    north = corner.includes("n");
  const fixedX = grid.cx + (west ? grid.w / 2 : -grid.w / 2),
    fixedY = grid.cy + (north ? grid.h / 2 : -grid.h / 2);
  const movingX = west
    ? limit(x, 0, fixedX - 0.05)
    : limit(x, fixedX + 0.05, 1);
  const movingY = north
    ? limit(y, 0, fixedY - 0.05)
    : limit(y, fixedY + 0.05, 1);
  return constrainGrid({
    ...grid,
    cx: (fixedX + movingX) / 2,
    cy: (fixedY + movingY) / 2,
    w: Math.abs(fixedX - movingX),
    h: Math.abs(fixedY - movingY),
  });
}
type OverlayProps = {
  grids: ManualGrid[];
  activeId: string;
  onSelect: (id: string) => void;
  onStart: () => void;
  onEnd: (grids: ManualGrid[], changed: boolean) => void;
  onRemove: (id: string) => void;
  width: number;
  height: number;
  style: CloakOptions["grid"];
  paint: boolean;
};
export function ManualGridOverlay({
  grids,
  activeId,
  onSelect,
  onStart,
  onEnd,
  onRemove,
  width,
  height,
  style,
  paint,
}: OverlayProps) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [draft, setDraft] = useState(grids);
  const state = useRef<{
    id: string;
    corner?: Corner;
    startX: number;
    startY: number;
    original: ManualGrid[];
    current: ManualGrid[];
    bounds: DOMRect;
  } | null>(null);
  const pending = useRef<number | null>(null);
  const latestEnd=useRef(onEnd);latestEnd.current=onEnd;
  const patternPrefix = useId().replace(/:/g, "");
  const gridKey = JSON.stringify(grids);
  useEffect(() => {
    if (!state.current) setDraft(grids);
  }, [gridKey]);
  useEffect(() => {
    const element = host.current?.parentElement;
    if (!element) return;
    const update = () => {
      const r = element.getBoundingClientRect();
      const w = Math.min(r.width, r.height * (width / height));
      setSize({ w, h: (w * height) / width });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width, height]);
  useEffect(
    () => () => {
      if (pending.current != null) cancelAnimationFrame(pending.current);
      if(state.current){const original=state.current.original;state.current=null;latestEnd.current(original,false);}
    },
    [],
  );
  const begin = (
    event: PointerEvent<HTMLElement>,
    grid: ManualGrid,
    corner?: Corner,
  ) => {
    if (event.button !== 0 || !host.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(grid.id);
    const bounds = host.current.getBoundingClientRect();
    state.current = {
      id: grid.id,
      corner,
      startX: (event.clientX - bounds.left) / bounds.width,
      startY: (event.clientY - bounds.top) / bounds.height,
      original: grids.map((g) => ({ ...g })),
      current: grids,
      bounds,
    };
    onStart();
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = state.current;
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    const x = (event.clientX - current.bounds.left) / current.bounds.width,
      y = (event.clientY - current.bounds.top) / current.bounds.height;
    current.current = current.original.map((grid) =>
      grid.id !== current.id
        ? grid
        : current.corner
          ? resizeGrid(grid, current.corner, x, y)
          : constrainGrid({
              ...grid,
              cx: grid.cx + x - current.startX,
              cy: grid.cy + y - current.startY,
            }),
    );
    if (pending.current == null)
      pending.current = requestAnimationFrame(() => {
        pending.current = null;
        if (state.current) setDraft(state.current.current);
      });
  };
  const end = (cancel = false) => {
    const current = state.current;
    if (!current) return;
    if (pending.current != null) {
      cancelAnimationFrame(pending.current);
      pending.current = null;
    }
    state.current = null;
    const final = cancel ? current.original : current.current;
    setDraft(final);
    onEnd(
      final,
      !cancel && JSON.stringify(final) !== JSON.stringify(current.original),
    );
  };
  const keyboard = (
    event: KeyboardEvent<HTMLElement>,
    grid: ManualGrid,
    corner?: Corner,
  ) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      end(true);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      end(true);
      onRemove(grid.id);
      return;
    }
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.01 : 0.002;
    const dx =
        event.key === "ArrowRight"
          ? step
          : event.key === "ArrowLeft"
            ? -step
            : 0,
      dy =
        event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    const changed = corner
      ? resizeGrid(
          grid,
          corner,
          grid.cx + (corner.includes("w") ? -grid.w / 2 : grid.w / 2) + dx,
          grid.cy + (corner.includes("n") ? -grid.h / 2 : grid.h / 2) + dy,
        )
      : constrainGrid({ ...grid, cx: grid.cx + dx, cy: grid.cy + dy });
    onSelect(grid.id);
    onEnd(
      grids.map((item) => (item.id === grid.id ? changed : item)),
      true,
    );
  };
  const color = `rgb(${[...style.color].reverse().join(",")})`;
  const geometry=(g:ManualGrid)=>{
    const bw=Math.max(6,g.w*width),bh=Math.max(6,g.h*height);
    const rawX1=Math.trunc(g.cx*width-bw/2),rawY1=Math.trunc(g.cy*height-bh/2),rawX2=Math.trunc(g.cx*width+bw/2),rawY2=Math.trunc(g.cy*height+bh/2);
    const mx=Math.round((rawX2-rawX1)*style.margin),my=Math.round((rawY2-rawY1)*style.margin);
    const x1=Math.max(0,rawX1-mx),y1=Math.max(0,rawY1-my),x2=Math.min(width,rawX2+mx),y2=Math.min(height,rawY2+my);
    const scale=size.w/width;const sourceW=x2-x1,sourceH=y2-y1;
    return{x:x1*scale,y:y1*scale,w:sourceW*scale,h:sourceH*scale,thickness:Math.max(1,Math.round(style.auto_thickness?Math.min(sourceW,sourceH)/140*style.thickness:style.thickness))*scale};
  };
  return (
    <div
      ref={host}
      className="manual-grid-editor"
      data-manual-grid-editor
      style={{ width: size.w, height: size.h }}
      aria-label="수동 격자 편집기"
    >
      {paint && (
        <svg
          className="manual-grid-live"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          aria-hidden="true"
          shapeRendering={style.line_aa?'geometricPrecision':'crispEdges'}
        >
          <defs>
            {draft.map((g, index) => {
              const {x,y,w,h,thickness}=geometry(g);
              const cellW = w / style.cols,
                cellH = h / style.rows;
              return (
                <pattern
                  key={g.id}
                  id={`${patternPrefix}-${index}`}
                  width={cellW}
                  height={cellH}
                  patternUnits="userSpaceOnUse"
                  x={x}
                  y={y}
                >
                  <path
                    d={`M ${cellW} 0 L 0 0 0 ${cellH}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={thickness}
                  />
                  {style.dots && (
                    <circle
                      cx="0"
                      cy="0"
                      r={style.dot_radius * (size.w / width)}
                      fill={color}
                    />
                  )}
                </pattern>
              );
            })}
          </defs>
          {draft.map((g, index) => {
            const {x,y,w,h}=geometry(g);
            return style.shape === "ellipse" ? (
              <ellipse
                key={g.id}
                cx={x+w/2}
                cy={y+h/2}
                rx={w / 2}
                ry={h / 2}
                fill={`url(#${patternPrefix}-${index})`}
                opacity={style.opacity}
              />
            ) : (
              <rect
                key={g.id}
                x={x}
                y={y}
                width={w}
                height={h}
                fill={`url(#${patternPrefix}-${index})`}
                opacity={style.opacity}
              />
            );
          })}
        </svg>
      )}
      {draft.map((grid, index) => (
        <div
          key={grid.id}
          className={`manual-grid-box ${grid.id === activeId ? "selected" : ""}`}
          style={{
            left: `${(grid.cx - grid.w / 2) * 100}%`,
            top: `${(grid.cy - grid.h / 2) * 100}%`,
            width: `${grid.w * 100}%`,
            height: `${grid.h * 100}%`,
          }}
        >
          <div
            className="manual-grid-move"
            role="button"
            tabIndex={0}
            aria-label={`격자 ${index + 1} 이동`}
            aria-pressed={grid.id === activeId}
            onFocus={() => onSelect(grid.id)}
            onPointerDown={(e) => begin(e, grid)}
            onPointerMove={move}
            onPointerUp={() => end()}
            onPointerCancel={() => end(true)}
            onLostPointerCapture={()=>end(true)}
            onKeyDown={(e) => keyboard(e, grid)}
          >
            <span className="manual-grid-number">
              {String(index + 1).padStart(2, "0")}
            </span>
          </div>
          {grid.id === activeId &&
            (["nw", "ne", "sw", "se"] as const).map((corner) => (
              <button
                key={corner}
                className={`manual-grid-handle ${corner}`}
                aria-label={`격자 ${index + 1} ${cornerLabels[corner]} 크기 조절`}
                onPointerDown={(e) => begin(e, grid, corner)}
                onPointerMove={move}
                onPointerUp={() => end()}
                onPointerCancel={() => end(true)}
                onLostPointerCapture={()=>end(true)}
                onKeyDown={(e) => keyboard(e, grid, corner)}
              >
                <i />
              </button>
            ))}
        </div>
      ))}
      {paint && (
        <span className="manual-grid-live-badge">
          즉시 배치 미리보기 · 놓으면 정확히 계산
        </span>
      )}
    </div>
  );
}
export function ManualGridControls({
  grids,
  activeId,
  onSelect,
  onChange,
  disabled = false,
}: {
  grids: ManualGrid[];
  activeId: string;
  onSelect: (id: string) => void;
  onChange: (grids: ManualGrid[]) => void;
  disabled?: boolean;
}) {
  const selected = grids.find((g) => g.id === activeId) ?? grids[0];
  const add = () => {
    const offset = (grids.length % 5) * 0.04;
    const g = constrainGrid({
      id: crypto.randomUUID(),
      cx: 0.45 + offset,
      cy: 0.45 + offset,
      w: 0.28,
      h: 0.36,
    });
    onChange([...grids, g]);
    onSelect(g.id);
  };
  const remove = () => {
    if (!selected) return;
    const next = grids.filter((g) => g.id !== selected.id);
    onChange(next);
    onSelect(next[0]?.id ?? "");
  };
  return (
    <div className="cloak-manual-controls">
      <div className="cloak-manual-title">
        <MousePointer2 size={13} />
        수동 격자 <span>{grids.length} / 16</span>
      </div>
      <div
        className="manual-grid-list"
        role="group"
        aria-label="수동 격자 선택"
      >
        {grids.map((g, index) => (
          <button
            key={g.id}
            disabled={disabled}
            aria-label={`격자 ${index + 1} 선택`}
            aria-pressed={g.id === selected?.id}
            onClick={() => onSelect(g.id)}
          >
            {String(index + 1).padStart(2, "0")}
          </button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || grids.length >= 16}
          onClick={add}
          aria-label="수동 격자 추가"
        >
          <Plus size={12} />
          추가
        </Button>
        {selected && (
          <Button
            size="sm"
            variant="ghost"
            onClick={remove}
            disabled={disabled}
            aria-label="선택한 수동 격자 삭제"
          >
            <Trash2 size={12} />
          </Button>
        )}
      </div>
      {selected ? (
        <div className="manual-grid-numbers">
          {(
            [
              { key: "cx", label: "가로 위치" },
              { key: "cy", label: "세로 위치" },
              { key: "w", label: "격자 너비" },
              { key: "h", label: "격자 높이" },
            ] as const
          ).map(({ key, label }) => (
            <label key={key}>
              {label}
              <input
                type="number"
                aria-label={label}
                min={key === "w" || key === "h" ? 0.05 : 0}
                max={1}
                step={0.01}
                disabled={disabled}
                value={selected[key]}
                onChange={(e) => {
                    if (e.target.value === ""||!Number.isFinite(e.target.valueAsNumber)) return;
                  onChange(
                    grids.map((g) =>
                      g.id === selected.id
                        ? constrainGrid({ ...g, [key]: Number(e.target.value) })
                        : g,
                    ),
                  );
                }}
              />
            </label>
          ))}
        </div>
      ) : (
        <p className="cloak-control-note">
          수동 격자가 없습니다. 추가하면 화면에서 배치할 수 있습니다.
        </p>
      )}
      <p className="cloak-control-note">
        격자는 끌어서 이동, 네 모서리는 크기 조절. 방향키로 미세 이동하고
        Shift로 크게 조절합니다. 선택 후 Delete로 삭제할 수 있습니다. 모든
        프레임에 같은 위치가 적용됩니다.
      </p>
    </div>
  );
}
