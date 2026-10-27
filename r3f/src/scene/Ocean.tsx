import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type * as THREE from "three";
import { skyState } from "../spectrum";
import { useSettingsEffect } from "../state/useSettingsEffect";
import { useSettings } from "../state/settingsStore";
import { countRender } from "../dev/renderCount";
import { PRI, useScene } from "./context";

export function Ocean({ geo }: { geo: THREE.BufferGeometry }) {
  countRender("scene.ocean");
  const { sim, ocean, sky, island } = useScene();
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const time = useRef(0);
  // 스펙트럼 재계산은 슬라이더 조작 중 끊김을 줄이려고 짧게 디바운스
  useSettingsEffect(
    (s) => [s.params.wind, s.params.peak, s.params.choppy, s.params.windDir],
    () => {
      const id = setTimeout(() => {
        sim.setParams(useSettings.getState().params);
        ocean.uniforms.uHs.value = sim.hs;
      }, 60);
      return () => clearTimeout(id);
    },
    [sim, ocean],
  );
  // FFT 해상도 변경 시 sim(타깃)이 재생성되므로 셰이더의 텍셀 수도 갱신
  useSettingsEffect(
    (s) => s.perf.detail,
    (detail) => {
      ocean.uniforms.uTexN.value.set(...sim.N);
      ocean.uniforms.uDetail.value = detail;
    },
    [ocean, sim],
  );
  useSettingsEffect(
    (s) => [s.params.hour, s.params.clouds],
    ([hour, clouds]) => {
      const s = skyState(hour, clouds),
        u = ocean.uniforms;
      u.uSun.value.set(...s.sun);
      u.uSunColor.value.setRGB(...s.sunColor);
      u.uSunI.value = s.sunI;
      u.uZenith.value.setRGB(...s.zenith);
      u.uHorizon.value.setRGB(...s.horizon);
      u.uClouds.value = clouds;
    },
    [ocean],
  );
  useSettingsEffect(
    (s) => s.look,
    (look) => {
      const u = ocean.uniforms;
      u.uDeep.value.set(look.deep);
      u.uShallow.value.set(look.shallow); // sRGB hex → 선형 (ColorManagement)
      u.uTurb.value = look.turbidity;
      u.uClarity.value = look.clarity;
      u.uDepth.value = look.depth;
    },
    [ocean],
  );
  useSettingsEffect(
    (s) => s.under,
    (under) => {
      ocean.uniforms.uUWCol.value.set(under.color);
      ocean.uniforms.uUWDens.value = under.density;
    },
    [ocean],
  );
  useSettingsEffect(
    (s) => s.shore,
    (shore) => {
      const u = ocean.uniforms;
      u.uShoreA.value = shore.shoreWave;
      u.uShoreLen.value = shore.shoreLen;
      u.uShoreFoam.value = shore.shoreFoam;
      u.uSharp.value = shore.sharp;
      u.uCollFoam.value = shore.collFoam;
      sim.setFoam(shore.collFoam, shore.persist);
      u.uFoamCol.value.set(shore.foamColor).multiplyScalar(shore.foamBright);
    },
    [ocean, sim],
  );
  useSettingsEffect(
    (s) => s.cube.caustics,
    (on) => {
      ocean.uniforms.uCaust.value = on ? 1 : 0;
    },
    [ocean],
  );
  // FFT 갱신 + 시간/카메라 유니폼
  useFrame((_, rdt) => {
    const dt = Math.min(rdt, 0.1),
      { perf } = useSettings.getState();
    time.current += dt;
    const t = time.current;
    const cur = sim.update(gl, t, dt, perf.mode, perf.nth);
    const u = ocean.uniforms;
    for (let c = 0; c < 3; c++) {
      u[`uDisp${c}`].value = sim.disp[c][cur[c]].texture;
      u[`uDer${c}`].value = sim.deriv[c].texture;
    }
    u.uTime.value = u.uTimeV.value = t;
    sky.uniforms.uTime.value = island.uniforms.uTime.value = t;
    island.uniforms.uCam.value.copy(camera.position);
    u.uCam.value.copy(camera.position);
    u.uCamV.value.copy(camera.position);
    sky.uniforms.uCam.value.copy(camera.position);
    u.uOffset.value.set(camera.position.x, camera.position.z);
  }, PRI.ocean);
  return <mesh geometry={geo} material={ocean} frustumCulled={false} />;
}
