import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { useShallow } from "zustand/shallow";
import { FFTOcean, type OceanSim } from "../fft";
import { FFTOceanGPU } from "../webgpu/fftGPU";
import {
  makeIslandMatGPU,
  makeOceanMatGPU,
  makeProbeGPU,
  makeSeabedGPU,
  makeSkyMatGPU,
} from "../webgpu/oceanTSL";
import type * as THREE from "three";
import { Q, useSettings } from "../state/settingsStore";
import { countRender } from "../dev/renderCount";
import { SceneContext, type SceneCtx } from "./context";
import {
  makeIslandMat,
  makeOceanMat,
  makeProbe,
  makeSeabed,
  makeSkyMat,
  radialGrid,
  type Cube,
} from "./resources";
import { Ocean } from "./Ocean";
import { Sky } from "./Sky";
import { Island, Seabed } from "./IslandSeabed";
import { FloatingCubes } from "./FloatingCubes";
import { useHeightProbe } from "./HeightProbe";

// 리소스 소유자: 그리드 링 수(품질)와 FFT 해상도만 구독 → 이것들이 바뀔 때만 재생성/리렌더
export function OceanScene({ children }: { children?: ReactNode }) {
  countRender("scene.root");
  const gl = useThree((s) => s.gl);
  const rings = useSettings((s) => Q[s.quality].rings);
  const n = useSettings(useShallow((s) => s.perf.n));
  const grid = useMemo(() => radialGrid(rings), [rings]);
  // WebGPURenderer면 TSL 노드 머티리얼 + 컴퓨트 FFT, 아니면 기존 GLSL 경로
  const gpu = (gl as unknown as { isWebGPURenderer?: boolean }).isWebGPURenderer === true;
  const sim = useMemo<OceanSim>(
    () =>
      gpu
        ? new FFTOceanGPU(n, Math.min(16, (gl as unknown as { getMaxAnisotropy(): number }).getMaxAnisotropy()))
        : new FFTOcean(n, Math.min(16, gl.capabilities.getMaxAnisotropy())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n[0], n[1], n[2], gl],
  );
  useEffect(() => () => sim.dispose(), [sim]);
  const ocean = useMemo(
    () => (gpu ? (makeOceanMatGPU(grid.g) as unknown as THREE.ShaderMaterial) : makeOceanMat(grid.g)),
    [grid.g, gpu],
  );
  const sky = useMemo(() => (gpu ? (makeSkyMatGPU() as unknown as THREE.ShaderMaterial) : makeSkyMat()), [gpu]);
  const island = useMemo(
    () => (gpu ? (makeIslandMatGPU() as unknown as THREE.ShaderMaterial) : makeIslandMat()),
    [gpu],
  );
  const probe = useMemo(
    () => (gpu ? (makeProbeGPU(ocean) as unknown as ReturnType<typeof makeProbe>) : makeProbe(ocean)),
    [ocean, gpu],
  );
  useEffect(() => () => probe.m.dispose(), [probe]);
  const seabed = useMemo(
    () => (gpu ? (makeSeabedGPU(ocean) as unknown as ReturnType<typeof makeSeabed>) : makeSeabed(ocean)),
    [ocean, gpu],
  );
  useEffect(
    () => () => {
      seabed.g.dispose();
      seabed.m.dispose();
    },
    [seabed],
  );
  const cubes = useRef<Cube[]>([]);
  const ctx = useMemo<SceneCtx>(
    () => ({ sim, ocean, sky, island, probe, seabed, cubes }),
    [sim, ocean, sky, island, probe, seabed],
  );
  return (
    <SceneContext.Provider value={ctx}>
      <Sky />
      <Ocean geo={grid.geo} />
      <Island />
      <Seabed />
      <FloatingCubes />
      <ProbeRunner />
      <ambientLight intensity={0.9} />
      {children}
    </SceneContext.Provider>
  );
}

function ProbeRunner() {
  useHeightProbe();
  return null;
}
