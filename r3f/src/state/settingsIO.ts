import { useSettings, type Settings } from "./settingsStore";
import { getCamView } from "../scene/CameraRig";

// 설정 내보내기 (디자이너에게 JSON으로 전달). 런타임 상태(큐브 인스턴스, FPS 등)는 제외
export const SETTINGS_VERSION = 1;

export function exportSettings(s: Settings = useSettings.getState()) {
  const { params: p, shore: sh, look, under, cube, perf } = s;
  const cam = getCamView();
  return {
    version: SETTINGS_VERSION,
    wave: {
      wind: p.wind,
      peak: p.peak,
      choppy: p.choppy,
      windDir: p.windDir,
      sharp: sh.sharp,
      collFoam: sh.collFoam,
      persist: sh.persist,
    },
    sky: { hour: p.hour, clouds: p.clouds },
    look: { ...look },
    shore: {
      shoreFoam: sh.shoreFoam,
      shoreWave: sh.shoreWave,
      shoreLen: sh.shoreLen,
      foamColor: sh.foamColor,
      foamBright: sh.foamBright,
    },
    underwater: { ...under },
    cube: { size: cube.size, density: cube.density, caustics: cube.caustics },
    perf: {
      quality: s.quality,
      n: [...perf.n],
      mode: perf.mode,
      nth: perf.nth,
      detail: perf.detail,
      dpr: s.dpr,
      dprCap: perf.dprCap,
      dyn: perf.dyn,
      target: perf.target,
      probeCube: perf.probeCube,
      probeIdle: perf.probeIdle,
      backend: perf.backend,
    },
    ...(cam ? { camera: cam } : {}),
  };
}
