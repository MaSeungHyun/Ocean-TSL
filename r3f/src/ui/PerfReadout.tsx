import { useEffect, useRef } from "react";
import { perfBus, type Stat } from "../state/perfBus";

// FPS/DPR/백엔드 표시: perfBus 구독, ref로 DOM 직접 갱신 (리렌더 없음)
export function PerfReadout() {
  const fps = useRef<HTMLSpanElement>(null),
    dpr = useRef<HTMLSpanElement>(null),
    be = useRef<HTMLSpanElement>(null),
    note = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const apply = (s: Stat) => {
      if (fps.current) fps.current.textContent = s.fps;
      if (dpr.current) dpr.current.textContent = s.dpr;
      if (be.current) be.current.textContent = s.backend || "…";
      if (note.current) {
        note.current.textContent = s.note;
        note.current.hidden = !s.note;
      }
    };
    apply(perfBus.get());
    return perfBus.on(apply);
  }, []);
  return (
    <div className="absolute left-3 top-3 rounded-sm bg-neutral-900/80 px-3 py-2 font-mono text-xs text-neutral-100">
      <span ref={fps}>--</span> · <span ref={dpr} /> · <span ref={be} />
      <div ref={note} hidden className="mt-1 text-amber-300" role="status" />
    </div>
  );
}
