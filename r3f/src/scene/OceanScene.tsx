import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { useShallow } from "zustand/shallow";
import { FFTOcean } from "../fft";
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
  const sim = useMemo(
    () => new FFTOcean(n, Math.min(16, gl.capabilities.getMaxAnisotropy())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n[0], n[1], n[2], gl],
  );
  useEffect(() => () => sim.dispose(), [sim]);
  const ocean = useMemo(() => makeOceanMat(grid.g), [grid.g]);
  const sky = useMemo(makeSkyMat, []);
  const island = useMemo(makeIslandMat, []);
  const probe = useMemo(() => makeProbe(ocean), [ocean]);
  useEffect(() => () => probe.m.dispose(), [probe]);
  const seabed = useMemo(() => makeSeabed(ocean), [ocean]);
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
