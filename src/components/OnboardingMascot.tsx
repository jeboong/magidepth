import { useEffect, useRef, useState } from "react";
import { angleDelta, mascotFrames, samplePose, validateMascotManifest } from "./mascotPose";
import type { StartupWorkspace } from "./Onboarding";
import "./OnboardingMascot.css";

interface OnboardingMascotProps {
  active: boolean;
  selection: StartupWorkspace | null;
  hoverSide: StartupWorkspace | null;
}

export function OnboardingMascot({ active, selection, hoverSide }: OnboardingMascotProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const options = useRef({ selection, hoverSide });
  options.current = { selection, hoverSide };
  const wake = useRef<() => void>(() => {});
  const [state, setState] = useState<"loading" | "ready" | "fallback">("loading");
  const [posterFailed, setPosterFailed] = useState(false);
  const base = `${import.meta.env.BASE_URL}brand/onboarding-mascot/`;

  useEffect(() => { wake.current(); }, [selection, hoverSide]);
  useEffect(() => {
    if (!active) return;
    const node = root.current, output = canvas.current;
    if (!node || !output) return;
    let disposed = false;
    let loadFailed = false;
    let raf = 0;
    const abort = new AbortController();
    const bitmaps: ImageBitmap[] = [];
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    let targetAngle = 0, angle = 0, targetNeutral = true, neutral = true;
    let lastTime = 0, lastKey = "";
    let draw: ((time: number) => void) | undefined;
    const schedule = () => {
      if (!disposed && !document.hidden && !raf && draw) raf = requestAnimationFrame(time => draw?.(time));
    };
    wake.current = schedule;
    const recenter = () => { targetNeutral = true; targetAngle = 0; schedule(); };
    const pointer = (event: PointerEvent) => {
      if (event.pointerType === "touch" || reduced) return;
      const bounds = node.getBoundingClientRect();
      const dx = event.clientX - bounds.left - bounds.width / 2;
      const dy = event.clientY - bounds.top - bounds.height / 2;
      const distance = Math.hypot(dx, dy) / Math.max(1, bounds.width);
      if (distance < .13) { recenter(); return; }
      targetNeutral = false;
      targetAngle = Math.atan2(-dy, dx) * 180 / Math.PI;
      schedule();
    };
    const onMotion = () => { reduced = motion.matches; node.dataset.reducedMotion = String(reduced); if (reduced) neutral = targetNeutral = true; lastKey = ""; schedule(); };
    const onVisibility = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else { lastTime = 0; recenter(); }
    };
    node.dataset.reducedMotion = String(reduced);
    document.addEventListener("pointermove", pointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", recenter);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", recenter);
    motion.addEventListener("change", onMotion);
    const themeObserver = new MutationObserver(() => { lastKey = ""; schedule(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    setState("loading");

    void (async () => {
      try {
        const response = await fetch(`${base}manifest.json`, { signal: abort.signal });
        if (!response.ok) throw new Error("Mascot manifest unavailable");
        const manifest = validateMascotManifest(await response.json());
        const frames = mascotFrames(manifest);
        await Promise.all(manifest.sheets.map(async (sheet, index) => {
          const response = await fetch(`${base}${sheet.file}`, { signal: abort.signal });
          if (!response.ok) throw new Error("Mascot sheet unavailable");
          const bitmap = await createImageBitmap(await response.blob());
          if (disposed || loadFailed) { bitmap.close(); return; }
          bitmaps[index] = bitmap;
          if (bitmap.width !== sheet.width || bitmap.height !== sheet.height) throw new Error("Unexpected mascot dimensions");
        }));
        if (disposed) return;
        const ctx = output.getContext("2d", { alpha: true });
        if (!ctx) throw new Error("Canvas unavailable");
        output.width = manifest.width; output.height = manifest.height;
        node.dataset.frameMin = String(Math.min(...manifest.frames.map(frame => frame.sourceFrame)));
        node.dataset.frameMax = String(Math.max(...manifest.frames.map(frame => frame.sourceFrame)));
        draw = (time) => {
          raf = 0;
          if (disposed || document.hidden) return;
          const dt = lastTime ? Math.min(40, time - lastTime) : 16;
          lastTime = time;
          const smoothing = 1 - Math.exp(-dt / 85);
          if (reduced) neutral = true;
          else {
            angle += angleDelta(angle, targetAngle) * smoothing;
            if (Math.abs(angleDelta(angle, targetAngle)) < .08) angle = targetAngle;
            // A cursor held near the face must never hold a double-exposed
            // neutral/directional blend. Return through the recorded turn first.
            neutral = targetNeutral && Math.abs(angleDelta(angle, 0)) < .5;
          }
          const samples = samplePose(manifest, angle, neutral ? 1 : 0);
          const colors = getComputedStyle(node);
          const depthColor = colors.getPropertyValue("--mascot-depth").trim();
          const cloakColor = colors.getPropertyValue("--mascot-cloak").trim();
          const { selection, hoverSide } = options.current;
          const key = `${samples.map(sample => `${sample.index}:${Math.round(sample.weight * 500)}`).join("|")}/${selection}/${hoverSide}/${depthColor}/${cloakColor}`;
          if (key !== lastKey) {
            ctx.clearRect(0, 0, output.width, output.height);
            // Add premultiplied contributions so crossfades retain real alpha,
            // rather than painting black or making opaque regions translucent.
            ctx.globalCompositeOperation = "lighter";
            for (const sample of samples) {
              const frame = frames[sample.index];
              ctx.globalAlpha = sample.weight;
              ctx.drawImage(bitmaps[frame.sheet], frame.x, frame.y, manifest.width, manifest.height, 0, 0, manifest.width, manifest.height);
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-atop";
            for (const side of ["depth", "cloak"] as const) {
              const amount = hoverSide === side ? .38 : selection === side ? .25 : 0;
              if (!amount) continue;
              ctx.fillStyle = `rgb(${side === "depth" ? depthColor : cloakColor} / ${amount})`;
              ctx.fillRect(side === "depth" ? 0 : output.width / 2, 0, output.width / 2, output.height);
            }
            ctx.globalCompositeOperation = "source-over";
            const dominant = samples.reduce((best, sample) => sample.weight > best.weight ? sample : best);
            node.dataset.frame = String(frames[dominant.index].sourceFrame);
            node.dataset.angle = String(Math.round(angle * 100) / 100);
            lastKey = key;
          }
          if (!reduced && Math.abs(angleDelta(angle, targetAngle)) > .08) schedule();
        };
        draw(performance.now()); setState("ready");
      } catch {
        if (!disposed) {
          loadFailed = true;
          abort.abort();
          bitmaps.forEach(bitmap => bitmap?.close());
          bitmaps.length = 0;
          setState("fallback");
        }
      }
    })();
    return () => {
      disposed = true;
      abort.abort(); cancelAnimationFrame(raf);
      bitmaps.forEach(bitmap => bitmap?.close());
      wake.current = () => {};
      document.removeEventListener("pointermove", pointer);
      document.documentElement.removeEventListener("pointerleave", recenter);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", recenter);
      motion.removeEventListener("change", onMotion);
      themeObserver.disconnect();
    };
  }, [active, base]);

  return <div ref={root} className="onboarding-mascot" data-testid="onboarding-mascot" data-state={state} role="img" aria-label="마우스 방향을 바라보는 매지코">
    <canvas ref={canvas} className="onboarding-mascot-canvas" aria-hidden="true" />
    {state !== "ready" && <img className="onboarding-mascot-poster" src={state === "fallback" || posterFailed ? `${import.meta.env.BASE_URL}brand/magidepth.png` : `${base}poster.webp`} alt="" draggable={false} onError={() => setPosterFailed(true)} />}
    {state === "fallback" && <span className="onboarding-mascot-fallback" role="status">정지 이미지로 표시 중</span>}
  </div>;
}
