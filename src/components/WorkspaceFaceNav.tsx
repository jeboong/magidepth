import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import type { StartupWorkspace } from "./Onboarding";
import "./WorkspaceFaceNav.css";

interface WorkspaceFaceNavProps {
  value: StartupWorkspace;
  onChange: (workspace: StartupWorkspace) => void;
  depthBusy: boolean;
  cloakBusy: boolean;
}

/** The same left-depth/right-cloak face used by onboarding, as a persistent switcher. */
export function WorkspaceFaceNav({ value, onChange, depthBusy, cloakBusy }: WorkspaceFaceNavProps) {
  const left = useRef<HTMLButtonElement>(null);
  const right = useRef<HTMLButtonElement>(null);
  const face = `${import.meta.env.BASE_URL}brand/magidepth.png`;
  const selectWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const next = event.key === "ArrowLeft" || event.key === "Home" ? "depth" : "cloak";
    onChange(next);
    (next === "depth" ? left : right).current?.focus();
  };

  return (
    <nav
      className="workspace-face-nav"
      role="tablist"
      aria-label="마법 작업실 선택 — 왼쪽 얼굴 MagiDepth, 오른쪽 얼굴 MagiCloak"
      data-testid="workspace-face-selector"
      style={{ "--workspace-face": `url("${face}")` } as CSSProperties}
    >
      <span className="workspace-face-aura" aria-hidden="true" />
      <img className="workspace-face-image" src={face} alt="" draggable={false} />
      {(["depth", "cloak"] as const).map((key) => {
        const selected = value === key;
        const busy = key === "depth" ? depthBusy : cloakBusy;
        const name = key === "depth" ? "MagiDepth" : "MagiCloak";
        return (
          <button
            key={key}
            ref={key === "depth" ? left : right}
            className={`workspace-face-half workspace-face-${key}`}
            id={`workspace-tab-${key}`}
            role="tab"
            aria-label={name}
            aria-selected={selected}
            aria-controls={`workspace-panel-${key}`}
            aria-describedby={`workspace-hint-${key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => { if (!selected) onChange(key); }}
            onKeyDown={selectWithKeyboard}
            data-testid={`workspace-${key}-half`}
          >
            <span className="workspace-face-tint" aria-hidden="true" />
            <span className="workspace-face-outline" aria-hidden="true" />
            <span className="workspace-face-label" aria-hidden="true">
              <span className="workspace-face-name">
                <Check size={11} className="workspace-face-check" />{name}
                {busy && <span className="workspace-busy-dot" />}
              </span>
            </span>
            <span id={`workspace-hint-${key}`} className="sr-only">
              {key === "depth" ? "왼쪽" : "오른쪽"} 얼굴을 눌러 전환합니다. {busy ? "작업 진행 중. " : ""}좌우 방향키로도 전환할 수 있습니다.
            </span>
          </button>
        );
      })}
      <span className="workspace-face-seam" aria-hidden="true" />
    </nav>
  );
}
