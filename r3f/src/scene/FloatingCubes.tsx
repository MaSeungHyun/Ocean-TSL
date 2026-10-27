import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSettings } from "../state/settingsStore";
import { useSettingsEffect } from "../state/useSettingsEffect";
import { countRender } from "../dev/renderCount";
import { PRI, useScene } from "./context";
import { MAX_CUBES, PER_CUBE } from "./resources";

// 부유 큐브: 메시/물리 상태는 ref, 설정은 프레임마다 getState()로 읽음
export function FloatingCubes() {
  countRender("scene.cubes");
  const { ocean, probe, cubes } = useScene();
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null!);
  const cubeRes = useMemo(
    () => ({
      geo: new THREE.BoxGeometry(1, 1, 1),
      mat: (() => {
        const m = new THREE.MeshStandardMaterial({
          color: "#d9822b",
          roughness: 0.75,
        });
        // 수중 안개: 오션과 같은 유니폼(uUnderG/uUWCol/uUWDens) 공유, 시선 거리 기반 감쇠
        m.onBeforeCompile = (sh) => {
          const u = ocean.uniforms;
          sh.uniforms.uUnderG = u.uUnderG;
          sh.uniforms.uUWCol = u.uUWCol;
          sh.uniforms.uUWDens = u.uUWDens;
          sh.fragmentShader =
            "uniform float uUnderG; uniform vec3 uUWCol; uniform float uUWDens;\n" +
            sh.fragmentShader.replace(
              "#include <dithering_fragment>",
              "#include <dithering_fragment>\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, uUWCol * 0.6, uUnderG * (1.0 - exp(-uUWDens * length(vViewPosition))));",
            );
        };
        return m;
      })(),
    }),
    [ocean],
  );
  useEffect(
    () => () => {
      cubeRes.geo.dispose();
      cubeRes.mat.dispose();
    },
    [cubeRes],
  );
  const added = useRef(0),
    frameN = useRef(0);
  const spawn = (add: number, size: number) => {
    // 카메라 시선을 해수면(y=0)에 투영한 방향으로 15~22m 앞에 생성
    const f3 = new THREE.Vector3();
    camera.getWorldDirection(f3);
    const fw = new THREE.Vector3(f3.x, 0, f3.z);
    if (fw.lengthSq() < 1e-6) fw.set(0, 0, -1);
    fw.normalize();
    const hit =
        f3.y < -1e-3
          ? (-camera.position.y / f3.y) * Math.hypot(f3.x, f3.z)
          : 18,
      dist = THREE.MathUtils.clamp(hit, 15, 22);
    const side = new THREE.Vector3(-fw.z, 0, fw.x);
    while (added.current < add && cubes.current.length < MAX_CUBES) {
      const i = cubes.current.length,
        k = added.current++;
      const p = camera.position
        .clone()
        .addScaledVector(fw, Math.min(22, dist + (k % 3) * 2.5))
        .addScaledVector(side, ((k % 5) - 2) * size * 2.2);
      const mesh = new THREE.Mesh(cubeRes.geo, cubeRes.mat);
      mesh.rotation.order = "YXZ";
      mesh.rotation.y = k * 0.7;
      mesh.position.set(p.x, 0, p.z);
      group.current.add(mesh);
      cubes.current[i] = {
        mesh,
        anchor: new THREE.Vector2(p.x, p.z),
        vel: new THREE.Vector3(),
        rot: new THREE.Vector3(),
        rv: new THREE.Vector3(),
        yawV: 0,
        h: [0, 0, 0, 0, 0],
        drift: new THREE.Vector2(),
        ok: false,
      };
    }
    added.current = Math.min(added.current, add);
  };
  // 초기화 버튼: 기존 큐브 제거 (마운트 시에는 무시)
  const resets = useRef(useSettings.getState().cube.reset);
  useSettingsEffect(
    (s) => s.cube.reset,
    (r) => {
      if (resets.current === r) return;
      resets.current = r;
      for (const c of cubes.current) group.current.remove(c.mesh);
      cubes.current = [];
    },
    [],
  );
  // 생성 + 파고 샘플점 (카메라 기준 상대 xz)
  useFrame(() => {
    const cube = useSettings.getState().cube;
    // 생성은 첫 몇 프레임 이후 (OrbitControls가 카메라 방향을 맞춘 뒤) 수행
    if (added.current !== cube.add && ++frameN.current > 4)
      spawn(cube.add, cube.size);
    const cs = cubes.current,
      pu = probe.m.uniforms,
      P = pu.uPts.value as THREE.Vector2[],
      cx = camera.position.x,
      cz = camera.position.z,
      half2 = cube.size * 0.5;
    cs.forEach((c, i) => {
      const b = i * PER_CUBE,
        yaw = c.mesh.rotation.y,
        ax = Math.cos(yaw) * half2,
        az = -Math.sin(yaw) * half2,
        px = c.mesh.position.x - cx,
        pz = c.mesh.position.z - cz;
      P[b].set(c.anchor.x - cx, c.anchor.y - cz);
      P[b + 1].set(px, pz);
      P[b + 2].set(px + ax, pz + az);
      P[b + 3].set(px - ax, pz - az);
      P[b + 4].set(px - az, pz + ax);
      P[b + 5].set(px + az, pz - ax);
    }); // ±로컬x, ±로컬z
    pu.uNPts.value = cs.length * PER_CUBE;
  }, PRI.cubeSample);
  // 큐브 물리: 부력(잠긴 비율/밀도) + 감쇠, 수평은 파도 궤도운동(기준점 변위) 추종, 기울기는 모서리 파고로 맞춘 평면에 스프링
  useFrame((_, rdt) => {
    const dt = Math.min(rdt, 0.1),
      cube = useSettings.getState().cube,
      cs = cubes.current;
    for (const c of cs) {
      if (!c.ok) continue;
      const s = cube.size,
        m = c.mesh,
        v = c.vel;
      m.scale.setScalar(s);
      const sub = THREE.MathUtils.clamp(
        (c.h[0] - (m.position.y - s / 2)) / s,
        0,
        1,
      );
      v.y += (9.81 * (sub / cube.density - 1) - v.y * 2.2) * dt;
      v.y = THREE.MathUtils.clamp(v.y, -12, 12);
      m.position.y += v.y * dt;
      const tx = c.anchor.x + c.drift.x * 0.9,
        tz = c.anchor.y + c.drift.y * 0.9,
        kx = 6,
        dx = 2 * Math.sqrt(kx) * 0.8;
      v.x += ((tx - m.position.x) * kx - v.x * dx) * dt;
      v.z += ((tz - m.position.z) * kx - v.z * dx) * dt;
      m.position.x += v.x * dt;
      m.position.z += v.z * dt;
      const wet = Math.min(1, sub * 4),
        sx = (c.h[1] - c.h[2]) / s,
        sz = (c.h[3] - c.h[4]) / s;
      const trz = Math.atan(sx) * 0.9 * wet,
        trx = -Math.atan(sz) * 0.9 * wet,
        kr = 14,
        dr = 2 * Math.sqrt(kr) * 0.7;
      c.rv.z += ((trz - m.rotation.z) * kr - c.rv.z * dr) * dt;
      c.rv.x += ((trx - m.rotation.x) * kr - c.rv.x * dr) * dt;
      m.rotation.z += c.rv.z * dt;
      m.rotation.x += c.rv.x * dt;
      c.yawV += ((Math.random() - 0.5) * 0.3 - c.yawV * 0.5) * dt;
      m.rotation.y += c.yawV * dt;
    }
    (window as any).__cubes = cs.map((c) => ({
      y: +c.mesh.position.y.toFixed(3),
      h: +c.h[0].toFixed(3),
      rx: +c.mesh.rotation.x.toFixed(3),
      rz: +c.mesh.rotation.z.toFixed(3),
    }));
  }, PRI.cubePhysics);
  return <group ref={group} />;
}
