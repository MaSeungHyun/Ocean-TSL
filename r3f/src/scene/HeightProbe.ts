import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSettings } from "../state/settingsStore";
import { PRI, useScene } from "./context";
import { PER_CUBE, probeRT } from "./resources";

const _f = new THREE.Vector3(),
  _r = new THREE.Vector3(),
  _v2 = new THREE.Vector2();

// 파고 프로브: 근평면 가로선 파고 스트립 (GPU에서 수면 분할용) + 카메라/큐브 샘플 비동기 리드백,
// 그 결과로 수중 판정·분할·해저 가시성 갱신
export function useHeightProbe() {
  const { ocean, sky, island, probe, seabed, cubes } = useScene();
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    const perf = useSettings.getState().perf;
    const pc = camera as THREE.PerspectiveCamera,
      fw = _f,
      rt = _r;
    pc.getWorldDirection(fw);
    rt.setFromMatrixColumn(pc.matrixWorld, 0).normalize();
    const half =
      Math.tan((pc.fov * Math.PI) / 360) * pc.aspect * pc.near * 1.02;
    const pu = probe.m.uniforms;
    pu.uNearL.value.copy(fw).multiplyScalar(pc.near).addScaledVector(rt, -half);
    pu.uNearR.value.copy(fw).multiplyScalar(pc.near).addScaledVector(rt, half);
    {
      const prev = gl.getRenderTarget();
      gl.setRenderTarget(probeRT);
      gl.render(probe.scene, probe.cam);
      gl.setRenderTarget(prev);
    }
    gl.getDrawingBufferSize(_v2);
    for (const m of [ocean, sky, island]) {
      const q = m.uniforms;
      q.uWL.value = probeRT.texture;
      q.uRes.value.copy(_v2);
      q.uCamF.value.copy(fw);
      q.uNear.value = pc.near;
    }
    // 리드백: 행 1(카메라 + 큐브 샘플)만, 큐브가 있으면 probeCube / 없으면 probeIdle 프레임마다 (매 프레임 읽으면 getBufferSubData 스톨)
    const cs = cubes.current;
    if (
      !probe.busy &&
      (probe.k =
        (probe.k + 1) % (cs.length ? perf.probeCube : perf.probeIdle)) === 0
    ) {
      probe.busy = true;
      const n = 1 + cs.length * PER_CUBE,
        buf = new Float32Array(n * 4),
        snap = cs.slice();
      // WebGPU 시그니처: (rt, x, y, w, h, textureIndex) → 버퍼 인자를 넘기면 textures[buf]가 undefined
      const isGPU = (gl as unknown as { isWebGPURenderer?: boolean }).isWebGPURenderer;
      (isGPU
        ? (gl as unknown as { readRenderTargetPixelsAsync(rt: THREE.RenderTarget, x: number, y: number, w: number, h: number): Promise<ArrayLike<number>> }).readRenderTargetPixelsAsync(probeRT, 0, 1, n, 1)
        : gl.readRenderTargetPixelsAsync(probeRT, 0, 1, n, 1, buf))
        .then((res: ArrayLike<number> | void) => {
          // WebGPU는 새 배열을 반환 (버퍼를 채우지 않음)
          if (res && res !== buf) buf.set(Array.prototype.slice.call(res, 0, buf.length));
          if (Number.isFinite(buf[0])) probe.h = buf[0];
          snap.forEach((c, i) => {
            const b = (1 + i * PER_CUBE) * 4;
            if (!Number.isFinite(buf[b + 1])) return;
            c.drift.set(buf[b + 1], buf[b + 2]);
            for (let j = 0; j < 5; j++) c.h[j] = buf[b + (j + 1) * 4];
            if (!c.ok) {
              c.ok = true;
              c.mesh.position.y = c.h[0];
            }
          });
        })
        .finally(() => {
          probe.busy = false;
        });
    }
  }, PRI.probe);
  useFrame((_, rdt) => {
    // 수중 판정: 실제 파면 높이 기준 + 히스테리시스(±6cm), 전환은 부드럽게
    const depth = probe.h - camera.position.y;
    if (!probe.under && depth > 0.06) probe.under = true;
    else if (probe.under && depth < -0.06) probe.under = false;
    probe.blend +=
      ((probe.under ? 1 : 0) - probe.blend) * Math.min(1, rdt * 10);
    const ub = probe.blend < 0.002 ? 0 : probe.blend > 0.998 ? 1 : probe.blend;
    // 수면 ±0.6m 이내면 픽셀 분할, 1.2m 밖에서는 기존 전체 블렌드
    const split = 1 - THREE.MathUtils.smoothstep(Math.abs(depth), 0.6, 1.2);
    // 해저는 수중/수면 근처에서만 보임 (위에서는 불투명 수면이 가리고, 수면 셰이더가 굴절 해저를 직접 그림)
    seabed.m.visible = ub > 0 || split > 0;
    island.uniforms.uBedOn.value = seabed.m.visible ? 1 : 0;
    ocean.uniforms.uSnap.value.set(
      Math.round(camera.position.x / 2.5) * 2.5,
      Math.round(camera.position.z / 2.5) * 2.5,
    );
    for (const m of [ocean, sky, island]) {
      m.uniforms.uUnderG.value = ub;
      m.uniforms.uSplit.value = split;
      m.uniforms.uCamDepth.value = Math.max(depth, 0);
    }
    (window as any).__under = {
      h: probe.h,
      under: probe.under,
      blend: ub,
      split,
    };
  }, PRI.under);
}
