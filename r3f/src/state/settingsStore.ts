import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { shallow } from "zustand/shallow";
import type { UpdateMode } from "../fft";
import {
  WATER_PRESETS,
  SHORE_DEFAULT,
  type OceanParams,
  type WaterLook,
  type ShoreLook,
} from "../spectrum";

export type Quality = "low" | "medium" | "high";
// N: FFT 해상도, rings: 방사형 그리드 링 수 (정점 밀도)
export const Q: Record<Quality, { N: number; rings: number }> = {
  low: { N: 256, rings: 420 },
  medium: { N: 256, rings: 640 },
  high: { N: 512, rings: 900 },
};
export const qs = new URLSearchParams(location.search);
// 성능 옵션: 캐스케이드별 FFT 해상도, 갱신 주기, 원거리 디테일 컷오프, DPR, 파고 리드백 간격
export type Perf = {
  n: [number, number, number];
  mode: UpdateMode;
  nth: number;
  detail: number;
  dprCap: number;
  dyn: boolean;
  target: number;
  probeCube: number;
  probeIdle: number;
  backend: Backend;
};
export type Backend = "webgl" | "webgpu";
// WebGPU 지원 여부 (동기 판별: navigator.gpu 존재)
export const hasWebGPU = () => typeof navigator !== "undefined" && "gpu" in navigator;
export const PERF_Q: Record<Quality, [number, number, number]> = {
  low: [256, 128, 128],
  medium: [256, 256, 256],
  high: [512, 512, 512],
};
// 성능 설정 저장 (localStorage, 버전 키). 우선순위: 기본값 < 저장값 < URL 파라미터
const PERF_KEY = "ocean-tsl.r3f.perf.v1";
export const perfDefault = (q: Quality = "high"): Perf => ({
  n: [...PERF_Q[q]] as Perf["n"],
  mode: "every",
  nth: 2,
  detail: 600,
  dprCap: 2,
  dyn: false,
  target: 50,
  probeCube: 3,
  probeIdle: 8,
  // 기본 WebGPU (미지원 브라우저는 WebGL2)
  backend: hasWebGPU() ? "webgpu" : "webgl",
});
const isQ = (v: unknown): v is Quality =>
  v === "low" || v === "medium" || v === "high";
const isMode = (v: unknown): v is UpdateMode =>
  v === "every" || v === "alt" || v === "nth";
const num = (v: unknown, lo: number, hi: number, d: number, step = 0) => {
  const x =
    typeof v === "number" ? v : typeof v === "string" && v !== "" ? +v : NaN;
  if (!Number.isFinite(x)) return d;
  const c = Math.min(hi, Math.max(lo, x));
  return step ? Math.round(c / step) * step : c;
};
function loadPerf(qs: URLSearchParams): { quality: Quality; perf: Perf } {
  let st: Record<string, unknown> = {};
  try {
    const j = JSON.parse(localStorage.getItem(PERF_KEY) ?? "null");
    if (j && typeof j === "object" && !Array.isArray(j)) st = j;
  } catch {
    /* 손상된 값 무시 */
  }
  const uq = qs.get("q");
  const quality: Quality = isQ(uq) ? uq : isQ(st.quality) ? st.quality : "high";
  const d = perfDefault(quality),
    sp = (st.perf && typeof st.perf === "object" ? st.perf : {}) as Record<
      string,
      unknown
    >;
  const n = (
    !isQ(uq) &&
    Array.isArray(sp.n) &&
    sp.n.length === 3 &&
    sp.n.every((v) => v === 128 || v === 256 || v === 512)
      ? [...sp.n]
      : d.n
  ) as Perf["n"];
  const um = qs.get("upd");
  return {
    quality,
    perf: {
      n,
      mode: isMode(um) ? um : isMode(sp.mode) ? sp.mode : d.mode,
      nth: num(sp.nth, 2, 6, d.nth, 1),
      detail: num(qs.get("detail") ?? sp.detail, 50, 3000, d.detail, 10),
      dprCap: num(sp.dprCap, 0.5, 2, d.dprCap, 0.25),
      dyn: typeof sp.dyn === "boolean" ? sp.dyn : d.dyn,
      target: num(sp.target, 30, 120, d.target, 5),
      probeCube: num(sp.probeCube, 1, 12, d.probeCube, 1),
      probeIdle: num(sp.probeIdle, 1, 30, d.probeIdle, 1),
      backend:
        (qs.get("gpu") === "1" ||
          (qs.get("gpu") !== "0" &&
            (sp.backend === "webgl" || sp.backend === "webgpu" ? sp.backend : d.backend) === "webgpu")) &&
        hasWebGPU()
          ? "webgpu"
          : "webgl",
    },
  };
}
function savePerf(quality: Quality, perf: Perf) {
  try {
    if (
      quality === "high" &&
      JSON.stringify(perf) === JSON.stringify(perfDefault())
    )
      localStorage.removeItem(PERF_KEY);
    else localStorage.setItem(PERF_KEY, JSON.stringify({ quality, perf }));
  } catch {
    /* 저장 불가 환경 무시 */
  }
}

// 수중: 색(sRGB)과 밀도(1/m)
export interface UnderLook {
  color: string;
  density: number;
}
// 부유 큐브 설정: add/reset은 버튼 카운터
export interface CubeCfg {
  size: number;
  density: number;
  add: number;
  reset: number;
  caustics: boolean;
}
export const UNDER_DEFAULT: UnderLook = { color: "#0f7f86", density: 0.09 };

export interface Settings {
  params: OceanParams;
  look: WaterLook;
  shore: ShoreLook;
  under: UnderLook;
  cube: CubeCfg;
  quality: Quality;
  perf: Perf;
  dpr: number;
  // 동적 해상도 현재값 (FrameStats가 0.5초마다 갱신, UI는 구독하지 않음)
  dynDpr: number;
  setParam: (k: keyof OceanParams, v: number) => void;
  setLook: <K extends keyof WaterLook>(k: K, v: WaterLook[K]) => void;
  applyLook: (look: WaterLook) => void;
  setShore: <K extends keyof ShoreLook>(k: K, v: ShoreLook[K]) => void;
  setUnder: <K extends keyof UnderLook>(k: K, v: UnderLook[K]) => void;
  setCube: <K extends "size" | "density" | "caustics">(
    k: K,
    v: CubeCfg[K],
  ) => void;
  addCube: () => void;
  resetCubes: () => void;
  setQuality: (q: Quality) => void;
  setPerf: <K extends keyof Perf>(k: K, v: Perf[K]) => void;
  setFftN: (i: 0 | 1 | 2, v: number) => void;
  setDpr: (v: number) => void;
  setDyn: (on: boolean) => void;
  setDynDpr: (v: number) => void;
  resetPerf: () => void;
}

const init = loadPerf(qs);
const dpr0 = +(qs.get("dpr") ?? Math.min(window.devicePixelRatio, 2));

export const useSettings = create<Settings>()(
  subscribeWithSelector((set) => ({
    params: {
      wind: +(qs.get("wind") ?? 9),
      peak: +(qs.get("peak") ?? 60),
      choppy: 1.3,
      windDir: -1.9,
      hour: +(qs.get("hour") ?? 15.5),
      clouds: +(qs.get("clouds") ?? 0.3),
    },
    look: WATER_PRESETS["먼바다"],
    shore: SHORE_DEFAULT,
    under: UNDER_DEFAULT,
    cube: {
      size: 1.5,
      density: 0.5,
      add: +(qs.get("cubes") ?? 1),
      reset: 0,
      caustics: true,
    },
    quality: init.quality,
    perf: init.perf,
    dpr: dpr0,
    dynDpr: dpr0,
    setParam: (k, v) => set((s) => ({ params: { ...s.params, [k]: v } })),
    setLook: (k, v) => set((s) => ({ look: { ...s.look, [k]: v } })),
    applyLook: (look) => set({ look }),
    setShore: (k, v) => set((s) => ({ shore: { ...s.shore, [k]: v } })),
    setUnder: (k, v) => set((s) => ({ under: { ...s.under, [k]: v } })),
    setCube: (k, v) => set((s) => ({ cube: { ...s.cube, [k]: v } })),
    addCube: () => set((s) => ({ cube: { ...s.cube, add: s.cube.add + 1 } })),
    resetCubes: () =>
      set((s) => ({ cube: { ...s.cube, reset: s.cube.reset + 1, add: 0 } })),
    setQuality: (q) =>
      set((s) => ({ quality: q, perf: { ...s.perf, n: PERF_Q[q] } })),
    setPerf: (k, v) => set((s) => ({ perf: { ...s.perf, [k]: v } })),
    setFftN: (i, v) =>
      set((s) => {
        const n = [...s.perf.n] as Perf["n"];
        n[i] = v;
        return { perf: { ...s.perf, n } };
      }),
    setDpr: (dpr) => set({ dpr }),
    setDyn: (on) =>
      set((s) => ({
        dynDpr: Math.min(s.dpr, s.perf.dprCap),
        perf: { ...s.perf, dyn: on },
      })),
    setDynDpr: (dynDpr) => set({ dynDpr }),
    resetPerf: () => {
      try {
        localStorage.removeItem(PERF_KEY);
      } catch {
        /* 무시 */
      }
      set((s) => ({
        quality: "high",
        perf: perfDefault(),
        dynDpr: Math.min(s.dpr, 2),
      }));
    },
  })),
);

// 실제 적용 DPR
export const curDpr = (s: Settings) =>
  s.perf.dyn
    ? Math.min(s.dynDpr, s.perf.dprCap)
    : Math.min(s.dpr, s.perf.dprCap);

// 성능 설정 영속화 (품질/성능 값이 바뀔 때만)
savePerf(init.quality, init.perf);
useSettings.subscribe(
  (s) => [s.quality, s.perf] as const,
  ([q, p]) => savePerf(q, p),
  { equalityFn: shallow },
);
