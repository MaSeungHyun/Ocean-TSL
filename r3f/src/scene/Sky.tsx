import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type * as THREE from "three";
import { skyState } from "../spectrum";
import { useSettingsEffect } from "../state/useSettingsEffect";
import { countRender } from "../dev/renderCount";
import { PRI, useScene } from "./context";

// 하늘 돔 + 태양/반구광
export function Sky() {
  countRender("scene.sky");
  const { sky } = useScene();
  const camera = useThree((s) => s.camera);
  const skyRef = useRef<THREE.Mesh>(null!);
  const sunRef = useRef<THREE.DirectionalLight>(null!);
  const hemiRef = useRef<THREE.HemisphereLight>(null!);
  useSettingsEffect(
    (s) => [s.params.hour, s.params.clouds],
    ([hour, clouds]) => {
      const s = skyState(hour, clouds),
        u = sky.uniforms;
      u.uSun.value.set(...s.sun);
      u.uSunColor.value.setRGB(...s.sunColor);
      u.uSunI.value = s.sunI;
      u.uZenith.value.setRGB(...s.zenith);
      u.uHorizon.value.setRGB(...s.horizon);
      u.uClouds.value = clouds;
      sunRef.current.position.set(
        s.sun[0] * 1000,
        s.sun[1] * 1000,
        s.sun[2] * 1000,
      );
      sunRef.current.color.setRGB(...s.sunColor);
      sunRef.current.intensity = s.sunI * 1.2;
      hemiRef.current.color.setRGB(...s.zenith);
      hemiRef.current.groundColor.setRGB(0.05, 0.08, 0.1);
      hemiRef.current.intensity = 1.5;
    },
    [sky],
  );
  useSettingsEffect(
    (s) => s.under,
    (under) => {
      sky.uniforms.uUWCol.value.set(under.color);
      sky.uniforms.uUWDens.value = under.density;
    },
    [sky],
  );
  useFrame(() => {
    skyRef.current.position.copy(camera.position);
  }, PRI.ocean);
  return (
    <>
      <mesh ref={skyRef} material={sky} frustumCulled={false} renderOrder={-1}>
        <sphereGeometry args={[40000, 64, 32]} />
      </mesh>
      <directionalLight ref={sunRef} />
      <hemisphereLight ref={hemiRef} />
    </>
  );
}
