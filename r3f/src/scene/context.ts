import { createContext, useContext, type MutableRefObject } from "react";
import type * as THREE from "three";
import type { FFTOcean } from "../fft";
import type { Cube, Probe, Seabed } from "./resources";

// OceanScene이 만든 GPU 리소스 공유 (품질/FFT 해상도 변경 시에만 교체)
export interface SceneCtx {
  sim: FFTOcean;
  ocean: THREE.ShaderMaterial;
  sky: THREE.ShaderMaterial;
  island: THREE.ShaderMaterial;
  probe: Probe;
  seabed: Seabed;
  cubes: MutableRefObject<Cube[]>;
}
export const SceneContext = createContext<SceneCtx | null>(null);
export const useScene = () => {
  const c = useContext(SceneContext);
  if (!c) throw new Error("useScene: OceanScene 밖에서 사용됨");
  return c;
};
// 프레임 순서 (낮을수록 먼저, 모두 기본 렌더 전)
export const PRI = {
  ocean: -7,
  camera: -6,
  cubeSample: -5,
  probe: -4,
  cubePhysics: -3,
  under: -2,
  stats: -1,
} as const;
