import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { curDpr, useSettings } from "./state/settingsStore";
import { countRender } from "./dev/renderCount";
import { OceanScene } from "./scene/OceanScene";
import { CameraRig, cam0 } from "./scene/CameraRig";
import { FrameStats } from "./scene/FrameStats";
import { Panel } from "./ui/Panel";
import { PerfReadout } from "./ui/PerfReadout";

// 초기값만 Canvas에 전달, 이후 DPR 변경은 FrameStats가 setDpr로 반영
const dpr0 = curDpr(useSettings.getState());
const camera0 = {
  position: [...cam0.pos] as [number, number, number],
  fov: 55,
  near: 0.3,
  far: 80000,
};
const gl0 = { antialias: true, powerPreference: "high-performance" } as const;

export default function App() {
  countRender("app");
  return (
    <div className="fixed inset-0">
      <Canvas
        dpr={dpr0}
        gl={gl0}
        camera={camera0}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.0;
        }}
      >
        <OceanScene>
          <CameraRig />
        </OceanScene>
        <FrameStats />
      </Canvas>
      <PerfReadout />
      <Panel />
    </div>
  );
}
