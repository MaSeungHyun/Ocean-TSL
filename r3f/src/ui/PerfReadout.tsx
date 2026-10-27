import { useEffect, useRef } from "react";
import { perfBus } from "../state/perfBus";

// FPS/DPR 표시: perfBus 구독, ref로 DOM 직접 갱신 (리렌더 없음)
export function PerfReadout() {
  const fps = useRef<HTMLSpanElement>(null),
    dpr = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const apply = (s: { fps: string; dpr: string }) => {
      if (fps.current) fps.current.textContent = s.fps;
      if (dpr.current) dpr.current.textContent = s.dpr;
    };
    apply(perfBus.get());
    return perfBus.on(apply);
  }, []);
  return (
    <div className="absolute left-3 top-3 rounded-sm bg-neutral-900/80 px-3 py-2 font-mono text-xs text-neutral-100">
      <span ref={fps}>--</span> · <span ref={dpr} /> · WebGL2 · GPU FFT
    </div>
  );
}
