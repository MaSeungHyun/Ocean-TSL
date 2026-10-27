import { useMemo } from "react";
import * as THREE from "three";
import { islandHeight, skyState } from "../spectrum";
import { useSettingsEffect } from "../state/useSettingsEffect";
import { countRender } from "../dev/renderCount";
import { useScene } from "./context";
import { ISLAND } from "./resources";

export function Island() {
  countRender("scene.island");
  const { island } = useScene();
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(360, 360, 220, 220);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i),
        h = islandHeight(x, z) + 3;
      p.setY(i, h);
      const t = Math.min(1, Math.max(0, (h - 3) / 4));
      const sand = [0.76, 0.68, 0.5],
        green = [0.16, 0.3, 0.1],
        rock = [0.35, 0.33, 0.3];
      col.set(
        h > 30 ? rock : sand.map((v, k) => v + (green[k] - v) * t),
        i * 3,
      );
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  useSettingsEffect(
    (s) => [s.params.hour, s.params.clouds],
    ([hour, clouds]) => {
      const s = skyState(hour, clouds),
        u = island.uniforms;
      u.uSun.value.set(...s.sun);
      u.uSunColor.value.setRGB(...s.sunColor);
      u.uSunI.value = s.sunI;
      u.uZenith.value.setRGB(...s.zenith);
      u.uHorizon.value.setRGB(...s.horizon);
      u.uClouds.value = clouds;
    },
    [island],
  );
  useSettingsEffect(
    (s) => s.look.depth,
    (d) => {
      island.uniforms.uDepth.value = d;
    },
    [island],
  );
  useSettingsEffect(
    (s) => s.under,
    (under) => {
      island.uniforms.uUWCol.value.set(under.color);
      island.uniforms.uUWDens.value = under.density;
    },
    [island],
  );
  useSettingsEffect(
    (s) => [s.shore.shoreWave, s.shore.shoreLen],
    ([wave, len]) => {
      island.uniforms.uShoreA.value = wave;
      island.uniforms.uShoreLen.value = len;
    },
    [island],
  );
  return (
    <mesh
      geometry={geo}
      material={island}
      position={[ISLAND.x, -3, ISLAND.y]}
    />
  );
}

// 해저 메시 (가시성은 HeightProbe가 수중/수면 근처에서만 켬)
export function Seabed() {
  countRender("scene.seabed");
  const { seabed } = useScene();
  return <mesh geometry={seabed.g} material={seabed.m} frustumCulled={false} />;
}
