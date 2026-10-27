import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { curDpr, useSettings } from "../state/settingsStore";
import { perfBus } from "../state/perfBus";
import { PRI } from "./context";

// FPS 집계 + 동적 해상도. React 상태 대신 perfBus/setDpr로 직접 반영
export function FrameStats() {
  const setDpr = useThree((s) => s.setDpr);
  const acc = useRef({ t: 0, n: 0, mx: 0 });
  useEffect(() => {
    const apply = (d: number) => {
      setDpr(d);
      perfBus.emit({ dpr: `DPR ${d.toFixed(2)}` });
    };
    apply(curDpr(useSettings.getState()));
    return useSettings.subscribe(curDpr, apply);
  }, [setDpr]);
  useFrame((_, rdt) => {
    const a = acc.current;
    a.t += rdt;
    a.n++;
    a.mx = Math.max(a.mx, rdt);
    if (a.t <= 0.5) return;
    const n = a.n / a.t,
      ms = (a.t * 1000) / a.n,
      mx = a.mx * 1000;
    a.t = 0;
    a.n = 0;
    a.mx = 0;
    (window as any).__fps = n;
    (window as any).__ms = ms;
    perfBus.emit({
      fps: `${n.toFixed(0)} FPS · ${ms.toFixed(1)} ms · 최대 ${mx.toFixed(0)} ms`,
    });
    const s = useSettings.getState(),
      p = s.perf;
    if (p.dyn)
      s.setDynDpr(
        THREE.MathUtils.clamp(
          +(
            s.dynDpr + (n < p.target - 3 ? -0.1 : n > p.target + 8 ? 0.05 : 0)
          ).toFixed(2),
          0.5,
          p.dprCap,
        ),
      );
  }, PRI.stats);
  return null;
}
