import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { qs } from "../state/settingsStore";
import { countRender } from "../dev/renderCount";
import { PRI, useScene } from "./context";

export const CAMS = {
  low: { pos: [-180, 2.2, -540], target: [-250, 2, -700] },
  high: { pos: [140, 160, 260], target: [-120, 0, -420] },
  shore: { pos: [-225, 7, -525], target: [-262, 0, -612] },
  top: { pos: [-262, 22, -548], target: [-262, 0, -556] },
  waterline: { pos: [-236, 0.02, -556], target: [-262, 0, -612] },
  under: { pos: [-236, -2.6, -556], target: [-262, -2.2, -612] },
  underUp: { pos: [-236, -4, -556], target: [-238, 1, -566] },
  floor: { pos: [-236, -3.5, -556], target: [-243, -8.5, -571] },
} as const;
export type CamKey = keyof typeof CAMS;
export const cam0 = CAMS[(qs.get("cam") as CamKey) ?? "low"] ?? CAMS.low;
const target0: [number, number, number] = [...cam0.target];
// ?wl=1: 카메라 높이를 실제 파고에 고정 (수면선 테스트용)
const wlLock = qs.get("wl") === "1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const controls: { current: any } = { current: null };
export function goCam(k: CamKey) {
  const c = controls.current;
  if (!c) return;
  c.object.position.set(...CAMS[k].pos);
  c.target.set(...CAMS[k].target);
  c.update();
}

export function CameraRig() {
  countRender("scene.camera");
  const { probe } = useScene();
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    (window as any).__cam = goCam;
  }, []);
  useFrame(() => {
    if (wlLock) camera.position.y = probe.h;
  }, PRI.camera);
  return (
    <OrbitControls
      ref={controls}
      target={target0}
      enableDamping={false}
      maxPolarAngle={Math.PI * 0.9}
      minDistance={1}
      maxDistance={3000}
    />
  );
}
