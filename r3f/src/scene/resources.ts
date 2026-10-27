import * as THREE from "three";
import { CASCADE_L, CASCADE_OFF, CASCADE_ROT, bakeShore } from "../spectrum";
import {
  islandFS,
  oceanFS,
  oceanVSBody,
  probeFS,
  seabedFS,
  seabedVS,
  skyFS,
} from "../glsl";

export const ISLAND = new THREE.Vector3(-260, -720, 150);
// 해안 거리장 (한 번만 베이크)
export const SHORE = bakeShore(512, 1000);
export const shoreTex = (() => {
  const t = new THREE.DataTexture(
    SHORE.data,
    SHORE.N,
    SHORE.N,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
})();
export const toneOut = (fs: string) =>
  fs.replace(
    /}\s*$/,
    "\n  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n}",
  );

export function radialGrid(rings: number, rMin = 0.3, rMax = 26000) {
  const g = Math.log(rMax / rMin) / rings,
    seg = Math.max(64, Math.round((2 * Math.PI) / g));
  const pos = new Float32Array((1 + (rings + 1) * seg) * 3),
    idx: number[] = [];
  let o = 3;
  for (let j = 0; j <= rings; j++) {
    const rr = rMin * Math.exp(j * g);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2 + (j % 2) * (Math.PI / seg);
      pos[o++] = Math.cos(a) * rr;
      pos[o++] = 0;
      pos[o++] = Math.sin(a) * rr;
    }
  }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = 1 + j * seg + i,
        b = 1 + j * seg + ((i + 1) % seg),
        c = 1 + (j + 1) * seg + i,
        d = 1 + (j + 1) * seg + ((i + 1) % seg);
      idx.push(a, b, c, b, d, c);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return { geo, g };
}

export const skyU = () => ({
  uTime: { value: 0 },
  uSun: { value: new THREE.Vector3() },
  uSunColor: { value: new THREE.Color() },
  uSunI: { value: 1 },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uClouds: { value: 0 },
  uCam: { value: new THREE.Vector3() },
  uUnderG: { value: 0 },
  uSplit: { value: 0 },
  uWL: { value: null as THREE.Texture | null },
  uRes: { value: new THREE.Vector2(1, 1) },
  uCamF: { value: new THREE.Vector3() },
  uNear: { value: 0.3 },
  uUWCol: { value: new THREE.Color() },
  uUWDens: { value: 0.09 },
  uCamDepth: { value: 0 },
});

export const STRIP = 256; // 근평면 가로 스트립 해상도 (픽셀 단위 수면 분할용)
export const MAX_PTS = 64,
  PER_CUBE = 6,
  MAX_CUBES = 10; // 큐브당 샘플: 기준점(수평 변위), 중심, 모서리 4
export const probeRT = new THREE.WebGLRenderTarget(STRIP, 2, {
  type: THREE.FloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  depthBuffer: false,
});
const probeTri = new THREE.BufferGeometry();
probeTri.setAttribute(
  "position",
  new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
);

export interface Cube {
  mesh: THREE.Mesh;
  anchor: THREE.Vector2;
  vel: THREE.Vector3;
  rot: THREE.Vector3;
  rv: THREE.Vector3;
  yawV: number;
  h: number[];
  drift: THREE.Vector2;
  ok: boolean;
}

export function makeOceanMat(g: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...skyU(),
      uTimeV: { value: 0 },
      uCamV: { value: new THREE.Vector3() },
      uOffset: { value: new THREE.Vector2() },
      uG: { value: g },
      uDisp0: { value: null },
      uDisp1: { value: null },
      uDisp2: { value: null },
      uDer0: { value: null },
      uDer1: { value: null },
      uDer2: { value: null },
      uL: { value: new THREE.Vector3(...CASCADE_L) },
      uRot: { value: new THREE.Vector3(...CASCADE_ROT) },
      uOff01: {
        value: new THREE.Vector4(...CASCADE_OFF[0], ...CASCADE_OFF[1]),
      },
      uOff2: { value: new THREE.Vector2(...CASCADE_OFF[2]) },
      uIsland: { value: ISLAND },
      uHs: { value: 1 },
      uTexN: { value: new THREE.Vector3(512, 512, 512) },
      uDetail: { value: 600 },
      uDeep: { value: new THREE.Color() },
      uShallow: { value: new THREE.Color() },
      uTurb: { value: 0 },
      uClarity: { value: 20 },
      uDepth: { value: 10 },
      uShore: { value: shoreTex },
      uShoreRect: { value: new THREE.Vector3(...SHORE.rect) },
      uShoreA: { value: 0.6 },
      uShoreLen: { value: 16 },
      uShoreFoam: { value: 1 },
      uSnap: { value: new THREE.Vector2() },
      uCaust: { value: 1 },
      uSharp: { value: 0.6 },
      uCollFoam: { value: 1 },
      uFoamCol: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: `precision highp float;\n${oceanVSBody}\nvoid main(){ vec3 w = oceanDisplace(position); gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
    fragmentShader: toneOut(oceanFS),
    side: THREE.DoubleSide,
    transparent: true,
  });
}

export function makeSkyMat() {
  return new THREE.ShaderMaterial({
    uniforms: skyU(),
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: toneOut(skyFS),
  });
}

export function makeIslandMat() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...skyU(),
      uShoreA: { value: 0.6 },
      uShore: { value: shoreTex },
      uShoreRect: { value: new THREE.Vector3(...SHORE.rect) },
      uShoreLen: { value: 16 },
      uDepth: { value: 10 },
      uBedOn: { value: 0 },
    },
    vertexColors: true,
    vertexShader: `varying vec3 vCol; varying vec3 vN; varying vec3 vWp;
void main(){ vec4 w = modelMatrix*vec4(position,1.0); vWp = w.xyz; vN = normalize(mat3(modelMatrix)*normal); vCol = color; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: toneOut(islandFS),
  });
}

// 카메라 위치 실제 수면 높이: 근평면 스트립 + 큐브 샘플점 패스, 비동기 리드백 (1~2 프레임 지연)
export function makeProbe(ocean: THREE.ShaderMaterial) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...ocean.uniforms,
      uNearL: { value: new THREE.Vector3() },
      uNearR: { value: new THREE.Vector3() },
      uStripN: { value: STRIP },
      uPts: {
        value: Array.from({ length: MAX_PTS }, () => new THREE.Vector2()),
      },
      uNPts: { value: 0 },
    },
    vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: probeFS,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(probeTri, m);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return {
    m,
    scene,
    cam: new THREE.Camera(),
    k: 0,
    busy: false,
    h: 0,
    under: false,
    blend: 0,
  };
}
export type Probe = ReturnType<typeof makeProbe>;

// 해저: 오션과 같은 유니폼 객체 공유 (물빛/수중/분할 상태 자동 반영)
export function makeSeabed(ocean: THREE.ShaderMaterial) {
  const g = new THREE.PlaneGeometry(640, 640, 256, 256);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    uniforms: ocean.uniforms,
    vertexShader: seabedVS,
    fragmentShader: toneOut(seabedFS),
  });
  return { g, m };
}
export type Seabed = ReturnType<typeof makeSeabed>;
