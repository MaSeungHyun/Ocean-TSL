import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Info as InfoIcon } from 'lucide-react'
import { INFO } from './settingInfo'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { FFTOcean, type UpdateMode } from './fft'
import { CASCADE_L, CASCADE_OFF, CASCADE_ROT, skyState, WATER_PRESETS, SHORE_DEFAULT, bakeShore, islandHeight, type OceanParams, type WaterLook, type ShoreLook } from './spectrum'
import { common, islandFS, oceanFS, oceanVSBody, probeFS, seabedFS, seabedVS, skyFS } from './glsl'

type Quality = 'low' | 'medium' | 'high'
// N: FFT 해상도, rings: 방사형 그리드 링 수 (정점 밀도)
const Q: Record<Quality, { N: number; rings: number }> = { low: { N: 256, rings: 420 }, medium: { N: 256, rings: 640 }, high: { N: 512, rings: 900 } }
const qs = new URLSearchParams(location.search)
// 성능 옵션: 캐스케이드별 FFT 해상도, 갱신 주기, 원거리 디테일 컷오프, DPR, 파고 리드백 간격
type Perf = { n: [number, number, number]; mode: UpdateMode; nth: number; detail: number; dprCap: number; dyn: boolean; target: number; probeCube: number; probeIdle: number }
const PERF_Q: Record<Quality, [number, number, number]> = { low: [256, 128, 128], medium: [256, 256, 256], high: [512, 512, 512] }
const wlLock = qs.get('wl') === '1'
const CAMS = { low: { pos: [-180, 2.2, -540], target: [-250, 2, -700] }, high: { pos: [140, 160, 260], target: [-120, 0, -420] }, shore: { pos: [-225, 7, -525], target: [-262, 0, -612] }, top: { pos: [-262, 22, -548], target: [-262, 0, -556] },
  waterline: { pos: [-236, 0.02, -556], target: [-262, 0, -612] }, under: { pos: [-236, -2.6, -556], target: [-262, -2.2, -612] }, underUp: { pos: [-236, -4, -556], target: [-238, 1, -566] }, floor: { pos: [-236, -3.5, -556], target: [-243, -8.5, -571] } } as const
// 수중: 색(sRGB)과 밀도(1/m)
interface UnderLook { color: string; density: number }
// 부유 큐브 설정: add/reset은 버튼 카운터
export interface CubeCfg { size: number; density: number; add: number; reset: number; caustics: boolean }
interface Cube { mesh: THREE.Mesh; anchor: THREE.Vector2; vel: THREE.Vector3; rot: THREE.Vector3; rv: THREE.Vector3; yawV: number; h: number[]; drift: THREE.Vector2; ok: boolean }
const UNDER_DEFAULT: UnderLook = { color: '#0f7f86', density: 0.09 }
const ISLAND = new THREE.Vector3(-260, -720, 150)
// 해안 거리장 (한 번만 베이크)
const SHORE = bakeShore(512, 1000)
const shoreTex = (() => { const t = new THREE.DataTexture(SHORE.data, SHORE.N, SHORE.N, THREE.RGBAFormat, THREE.FloatType)
  t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t })()
const toneOut = (fs: string) => fs.replace(/}\s*$/, '\n  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n}')

function radialGrid(rings: number, rMin = 0.3, rMax = 26000) {
  const g = Math.log(rMax / rMin) / rings, seg = Math.max(64, Math.round((2 * Math.PI) / g))
  const pos = new Float32Array((1 + (rings + 1) * seg) * 3), idx: number[] = []
  let o = 3
  for (let j = 0; j <= rings; j++) { const rr = rMin * Math.exp(j * g)
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2 + (j % 2) * (Math.PI / seg); pos[o++] = Math.cos(a) * rr; pos[o++] = 0; pos[o++] = Math.sin(a) * rr } }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i)
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = 1 + j * seg + i, b = 1 + j * seg + ((i + 1) % seg), c = 1 + (j + 1) * seg + i, d = 1 + (j + 1) * seg + ((i + 1) % seg)
    idx.push(a, b, c, b, d, c) }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx)
  return { geo, g }
}

const skyU = () => ({ uTime: { value: 0 }, uSun: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() }, uSunI: { value: 1 },
  uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uClouds: { value: 0 }, uCam: { value: new THREE.Vector3() },
  uUnderG: { value: 0 }, uSplit: { value: 0 }, uWL: { value: null as THREE.Texture | null }, uRes: { value: new THREE.Vector2(1, 1) }, uCamF: { value: new THREE.Vector3() }, uNear: { value: 0.3 }, uUWCol: { value: new THREE.Color() }, uUWDens: { value: 0.09 }, uCamDepth: { value: 0 } })
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _v2 = new THREE.Vector2()
const STRIP = 256   // 근평면 가로 스트립 해상도 (픽셀 단위 수면 분할용)
const MAX_PTS = 64, PER_CUBE = 6, MAX_CUBES = 10   // 큐브당 샘플: 기준점(수평 변위), 중심, 모서리 4
const probeRT = new THREE.WebGLRenderTarget(STRIP, 2, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false })
const probeTri = new THREE.BufferGeometry()
probeTri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))

function Island({ mat }: { mat: THREE.ShaderMaterial }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(360, 360, 220, 220)
    g.rotateX(-Math.PI / 2)
    const p = g.attributes.position as THREE.BufferAttribute
    const col = new Float32Array(p.count * 3)
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), h = islandHeight(x, z) + 3
      p.setY(i, h)
      const t = Math.min(1, Math.max(0, (h - 3) / 4))
      const sand = [0.76, 0.68, 0.5], green = [0.16, 0.3, 0.1], rock = [0.35, 0.33, 0.3]
      col.set(h > 30 ? rock : sand.map((v, k) => v + (green[k] - v) * t), i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals()
    return g
  }, [])
  return <mesh geometry={geo} material={mat} position={[ISLAND.x, -3, ISLAND.y]} />
}

function Scene({ params, look, shore, under, quality, fps, cube, perf }: { params: OceanParams; look: WaterLook; shore: ShoreLook; under: UnderLook; quality: Quality; fps: (n: number, ms: number, maxMs: number) => void; cube: CubeCfg; perf: Perf }) {
  const { camera, gl } = useThree()
  const q = Q[quality]
  const grid = useMemo(() => radialGrid(q.rings), [q.rings])
  const sim = useMemo(() => new FFTOcean(perf.n, Math.min(16, gl.capabilities.getMaxAnisotropy())), [perf.n[0], perf.n[1], perf.n[2], gl])
  useEffect(() => () => sim.dispose(), [sim])
  const ocean = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { ...skyU(), uTimeV: { value: 0 }, uCamV: { value: new THREE.Vector3() }, uOffset: { value: new THREE.Vector2() }, uG: { value: grid.g },
      uDisp0: { value: null }, uDisp1: { value: null }, uDisp2: { value: null }, uDer0: { value: null }, uDer1: { value: null }, uDer2: { value: null },
      uL: { value: new THREE.Vector3(...CASCADE_L) }, uRot: { value: new THREE.Vector3(...CASCADE_ROT) },
      uOff01: { value: new THREE.Vector4(...CASCADE_OFF[0], ...CASCADE_OFF[1]) }, uOff2: { value: new THREE.Vector2(...CASCADE_OFF[2]) },
      uIsland: { value: ISLAND }, uHs: { value: 1 }, uTexN: { value: new THREE.Vector3(512, 512, 512) }, uDetail: { value: 600 },
      uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uTurb: { value: 0 }, uClarity: { value: 20 }, uDepth: { value: 10 },
      uShore: { value: shoreTex }, uShoreRect: { value: new THREE.Vector3(...SHORE.rect) }, uShoreA: { value: 0.6 }, uShoreLen: { value: 16 },
      uShoreFoam: { value: 1 }, uSnap: { value: new THREE.Vector2() }, uCaust: { value: 1 }, uSharp: { value: 0.6 }, uCollFoam: { value: 1 }, uFoamCol: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: `precision highp float;\n${oceanVSBody}\nvoid main(){ vec3 w = oceanDisplace(position); gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
    fragmentShader: toneOut(oceanFS), side: THREE.DoubleSide, transparent: true,
  }), [grid.g])
  const sky = useMemo(() => new THREE.ShaderMaterial({ uniforms: skyU(), side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: toneOut(skyFS) }), [])
  void common
  const island = useMemo(() => new THREE.ShaderMaterial({ uniforms: { ...skyU(), uShoreA: { value: 0.6 }, uShore: { value: shoreTex }, uShoreRect: { value: new THREE.Vector3(...SHORE.rect) },
    uShoreLen: { value: 16 }, uDepth: { value: 10 }, uBedOn: { value: 0 } }, vertexColors: true,
    vertexShader: `varying vec3 vCol; varying vec3 vN; varying vec3 vWp;
void main(){ vec4 w = modelMatrix*vec4(position,1.0); vWp = w.xyz; vN = normalize(mat3(modelMatrix)*normal); vCol = color; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: toneOut(islandFS) }), [])
  // 카메라 위치 실제 수면 높이: 1x1 패스로 계산 후 비동기 리드백 (1~2 프레임 지연)
  const probe = useMemo(() => {
    const m = new THREE.ShaderMaterial({ uniforms: { ...ocean.uniforms, uNearL: { value: new THREE.Vector3() }, uNearR: { value: new THREE.Vector3() }, uStripN: { value: STRIP }, uPts: { value: Array.from({ length: MAX_PTS }, () => new THREE.Vector2()) }, uNPts: { value: 0 } }, vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: probeFS, depthTest: false, depthWrite: false })
    const mesh = new THREE.Mesh(probeTri, m); mesh.frustumCulled = false
    const scene = new THREE.Scene(); scene.add(mesh)
    return { m, scene, cam: new THREE.Camera(), k: 0, busy: false, h: 0, under: false, blend: 0 }
  }, [ocean])
  useEffect(() => () => probe.m.dispose(), [probe])
  // 해저: 오션과 같은 유니폼 객체 공유 (물빛/수중/분할 상태 자동 반영)
  const seabed = useMemo(() => {
    const g = new THREE.PlaneGeometry(640, 640, 256, 256); g.rotateX(-Math.PI / 2)
    const m = new THREE.ShaderMaterial({ uniforms: ocean.uniforms, vertexShader: seabedVS, fragmentShader: toneOut(seabedFS) })
    return { g, m }
  }, [ocean])
  useEffect(() => () => { seabed.g.dispose(); seabed.m.dispose() }, [seabed])
  useEffect(() => { ocean.uniforms.uCaust.value = cube.caustics ? 1 : 0 }, [ocean, cube.caustics])
  // 부유 큐브
  const cubeGroup = useRef<THREE.Group>(null!)
  const cubes = useRef<Cube[]>([])
  const cubeRes = useMemo(() => ({ geo: new THREE.BoxGeometry(1, 1, 1), mat: (() => { const m = new THREE.MeshStandardMaterial({ color: '#d9822b', roughness: 0.75 })
    // ?? ??: ??? ?? ???(uUnderG/uUWCol/uUWDens) ??, ?? ?? ?? ?? ??
    m.onBeforeCompile = (sh) => { const u = ocean.uniforms; sh.uniforms.uUnderG = u.uUnderG; sh.uniforms.uUWCol = u.uUWCol; sh.uniforms.uUWDens = u.uUWDens
      sh.fragmentShader = 'uniform float uUnderG; uniform vec3 uUWCol; uniform float uUWDens;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, uUWCol * 0.6, uUnderG * (1.0 - exp(-uUWDens * length(vViewPosition))));') }
    return m })() }), [ocean])
  useEffect(() => () => { cubeRes.geo.dispose(); cubeRes.mat.dispose() }, [cubeRes])
  const added = useRef(0), frameN = useRef(0)
  const spawn = () => {
    // ?? ??? ?? ??? ???(y=0)? ??? 15~22m ?? ??
    const f3 = new THREE.Vector3(); camera.getWorldDirection(f3)
    const fw = new THREE.Vector3(f3.x, 0, f3.z); if (fw.lengthSq() < 1e-6) fw.set(0, 0, -1); fw.normalize()
    const hit = f3.y < -1e-3 ? (-camera.position.y / f3.y) * Math.hypot(f3.x, f3.z) : 18, dist = THREE.MathUtils.clamp(hit, 15, 22)
    const side = new THREE.Vector3(-fw.z, 0, fw.x)
    while (added.current < cube.add && cubes.current.length < MAX_CUBES) {
      const i = cubes.current.length, k = added.current++
      const p = camera.position.clone().addScaledVector(fw, Math.min(22, dist + (k % 3) * 2.5)).addScaledVector(side, ((k % 5) - 2) * cube.size * 2.2)
      const mesh = new THREE.Mesh(cubeRes.geo, cubeRes.mat); mesh.rotation.order = 'YXZ'; mesh.rotation.y = k * 0.7; mesh.position.set(p.x, 0, p.z)
      cubeGroup.current.add(mesh)
      cubes.current[i] = { mesh, anchor: new THREE.Vector2(p.x, p.z), vel: new THREE.Vector3(), rot: new THREE.Vector3(), rv: new THREE.Vector3(), yawV: 0, h: [0, 0, 0, 0, 0], drift: new THREE.Vector2(), ok: false }
    }
    added.current = Math.min(added.current, cube.add)
  }
  // 생성은 첫 useFrame 이후 (OrbitControls가 카메라 방향을 맞춘 뒤) 수행
  const resets = useRef(cube.reset)
  useEffect(() => { if (resets.current === cube.reset) return; resets.current = cube.reset
    for (const c of cubes.current) cubeGroup.current.remove(c.mesh); cubes.current = [] }, [cube.reset])
  const skyRef = useRef<THREE.Mesh>(null!)
  const sunRef = useRef<THREE.DirectionalLight>(null!)
  const hemiRef = useRef<THREE.HemisphereLight>(null!)
  const acc = useRef({ t: 0, n: 0, time: 0, mx: 0 })
  // 스펙트럼 재계산은 슬라이더 조작 중 끊김을 줄이려고 짧게 디바운스
  useEffect(() => { const id = setTimeout(() => { sim.setParams(params); ocean.uniforms.uHs.value = sim.hs }, 60); return () => clearTimeout(id) },
    [sim, ocean, params.wind, params.peak, params.choppy, params.windDir])
  // FFT 해상도 변경 시 sim(타깃)이 재생성되므로 셰이더의 텍셀 수도 갱신
  useEffect(() => { ocean.uniforms.uTexN.value.set(...sim.N); ocean.uniforms.uDetail.value = perf.detail }, [ocean, sim, perf.detail])
  useEffect(() => {
    const s = skyState(params.hour, params.clouds)
    for (const m of [ocean, sky, island]) {
      m.uniforms.uSun.value.set(...s.sun); m.uniforms.uSunColor.value.setRGB(...s.sunColor); m.uniforms.uSunI.value = s.sunI
      m.uniforms.uZenith.value.setRGB(...s.zenith); m.uniforms.uHorizon.value.setRGB(...s.horizon); m.uniforms.uClouds.value = params.clouds
    }
    sunRef.current.position.set(s.sun[0] * 1000, s.sun[1] * 1000, s.sun[2] * 1000)
    sunRef.current.color.setRGB(...s.sunColor); sunRef.current.intensity = s.sunI * 1.2
    hemiRef.current.color.setRGB(...s.zenith); hemiRef.current.groundColor.setRGB(0.05, 0.08, 0.1); hemiRef.current.intensity = 1.5
  }, [ocean, sky, island, params.hour, params.clouds])
  useEffect(() => {
    const u = ocean.uniforms
    u.uDeep.value.set(look.deep); u.uShallow.value.set(look.shallow)   // sRGB hex → 선형 (ColorManagement)
    u.uTurb.value = look.turbidity; u.uClarity.value = look.clarity; u.uDepth.value = look.depth
    island.uniforms.uDepth.value = look.depth
  }, [ocean, island, look])
  useEffect(() => {
    for (const m of [ocean, sky, island]) { m.uniforms.uUWCol.value.set(under.color); m.uniforms.uUWDens.value = under.density }
  }, [ocean, sky, island, under])
  useEffect(() => {
    const u = ocean.uniforms
    u.uShoreA.value = island.uniforms.uShoreA.value = shore.shoreWave; u.uShoreLen.value = shore.shoreLen; u.uShoreFoam.value = shore.shoreFoam
    island.uniforms.uShoreLen.value = shore.shoreLen
    u.uSharp.value = shore.sharp; u.uCollFoam.value = shore.collFoam; sim.setFoam(shore.collFoam, shore.persist)
    u.uFoamCol.value.set(shore.foamColor).multiplyScalar(shore.foamBright)
  }, [ocean, island, sim, shore])
  useFrame((_, rdt) => {
    const dt = Math.min(rdt, 0.1), a = acc.current; a.time += dt
    const cur = sim.update(gl, a.time, dt, perf.mode, perf.nth)
    const u = ocean.uniforms
    for (let c = 0; c < 3; c++) { u[`uDisp${c}`].value = sim.disp[c][cur[c]].texture; u[`uDer${c}`].value = sim.deriv[c].texture }
    u.uTime.value = u.uTimeV.value = a.time; sky.uniforms.uTime.value = island.uniforms.uTime.value = a.time; island.uniforms.uCam.value.copy(camera.position)
    u.uCam.value.copy(camera.position); u.uCamV.value.copy(camera.position); sky.uniforms.uCam.value.copy(camera.position)
    u.uOffset.value.set(camera.position.x, camera.position.z)
    skyRef.current.position.copy(camera.position)
    // 수중 판정: 실제 파면 높이 기준 + 히스테리시스(±6cm), 전환은 부드럽게
    // 근평면 가로선의 파고 스트립 (매 프레임 GPU에서만 사용) + 가운데 텍셀만 비동기 리드백
    const pc = camera as THREE.PerspectiveCamera, fw = _f, rt = _r
    pc.getWorldDirection(fw); rt.setFromMatrixColumn(pc.matrixWorld, 0).normalize()
    const half = Math.tan((pc.fov * Math.PI) / 360) * pc.aspect * pc.near * 1.02
    const pu = probe.m.uniforms
    pu.uNearL.value.copy(fw).multiplyScalar(pc.near).addScaledVector(rt, -half); pu.uNearR.value.copy(fw).multiplyScalar(pc.near).addScaledVector(rt, half)
    // 큐브 샘플점 (카메라 기준 상대 xz)
    // OrbitControls? ??? ??? ?(? ??? ?)? ??
    if (added.current !== cube.add && ++frameN.current > 4) spawn()
    // ???: ?wl=1 ?? ???? ??? ?? ??? ?? (?? ???)
    if (wlLock) camera.position.y = probe.h
    const cs = cubes.current, P = pu.uPts.value as THREE.Vector2[], cx = camera.position.x, cz = camera.position.z, half2 = cube.size * 0.5
    cs.forEach((c, i) => { const b = i * PER_CUBE, yaw = c.mesh.rotation.y, ax = Math.cos(yaw) * half2, az = -Math.sin(yaw) * half2, px = c.mesh.position.x - cx, pz = c.mesh.position.z - cz
      P[b].set(c.anchor.x - cx, c.anchor.y - cz); P[b + 1].set(px, pz)
      P[b + 2].set(px + ax, pz + az); P[b + 3].set(px - ax, pz - az); P[b + 4].set(px - az, pz + ax); P[b + 5].set(px + az, pz - ax) })   // ±로컬x, ±로컬z
    pu.uNPts.value = cs.length * PER_CUBE
    { const prev = gl.getRenderTarget(); gl.setRenderTarget(probeRT); gl.render(probe.scene, probe.cam); gl.setRenderTarget(prev) }
    gl.getDrawingBufferSize(_v2)
    for (const m of [ocean, sky, island]) { const q = m.uniforms; q.uWL.value = probeRT.texture; q.uRes.value.copy(_v2); q.uCamF.value.copy(fw); q.uNear.value = pc.near }
    // 리드백: 행 1(카메라 + 큐브 샘플)만, 큐브가 있으면 3프레임마다 / 없으면 8프레임마다 (매 프레임 읽으면 getBufferSubData 스톨)
    if (!probe.busy && (probe.k = (probe.k + 1) % (cs.length ? perf.probeCube : perf.probeIdle)) === 0) {
      probe.busy = true
      const n = 1 + cs.length * PER_CUBE, buf = new Float32Array(n * 4), snap = cs.slice()
      gl.readRenderTargetPixelsAsync(probeRT, 0, 1, n, 1, buf).then(() => {
        if (Number.isFinite(buf[0])) probe.h = buf[0]
        snap.forEach((c, i) => { const b = (1 + i * PER_CUBE) * 4
          if (!Number.isFinite(buf[b + 1])) return
          c.drift.set(buf[b + 1], buf[b + 2]); for (let j = 0; j < 5; j++) c.h[j] = buf[b + (j + 1) * 4]
          if (!c.ok) { c.ok = true; c.mesh.position.y = c.h[0] } })
      }).finally(() => { probe.busy = false })
    }
    // 큐브 물리: 부력(잠긴 비율/밀도) + 감쇠, 수평은 파도 궤도운동(기준점 변위) 추종, 기울기는 모서리 파고로 맞춘 평면에 스프링
    for (const c of cs) {
      if (!c.ok) continue
      const s = cube.size, m = c.mesh, v = c.vel
      m.scale.setScalar(s)
      const sub = THREE.MathUtils.clamp((c.h[0] - (m.position.y - s / 2)) / s, 0, 1)
      v.y += (9.81 * (sub / cube.density - 1) - v.y * 2.2) * dt; v.y = THREE.MathUtils.clamp(v.y, -12, 12)
      m.position.y += v.y * dt
      const tx = c.anchor.x + c.drift.x * 0.9, tz = c.anchor.y + c.drift.y * 0.9, kx = 6, dx = 2 * Math.sqrt(kx) * 0.8
      v.x += ((tx - m.position.x) * kx - v.x * dx) * dt; v.z += ((tz - m.position.z) * kx - v.z * dx) * dt
      m.position.x += v.x * dt; m.position.z += v.z * dt
      const wet = Math.min(1, sub * 4), sx = (c.h[1] - c.h[2]) / s, sz = (c.h[3] - c.h[4]) / s
      const trz = Math.atan(sx) * 0.9 * wet, trx = -Math.atan(sz) * 0.9 * wet, kr = 14, dr = 2 * Math.sqrt(kr) * 0.7
      c.rv.z += ((trz - m.rotation.z) * kr - c.rv.z * dr) * dt; c.rv.x += ((trx - m.rotation.x) * kr - c.rv.x * dr) * dt
      m.rotation.z += c.rv.z * dt; m.rotation.x += c.rv.x * dt
      c.yawV += ((Math.random() - 0.5) * 0.3 - c.yawV * 0.5) * dt; m.rotation.y += c.yawV * dt
    }
    ;(window as any).__cubes = cs.map((c) => ({ y: +c.mesh.position.y.toFixed(3), h: +c.h[0].toFixed(3), rx: +c.mesh.rotation.x.toFixed(3), rz: +c.mesh.rotation.z.toFixed(3) }))
    const depth = probe.h - camera.position.y
    if (!probe.under && depth > 0.06) probe.under = true
    else if (probe.under && depth < -0.06) probe.under = false
    probe.blend += ((probe.under ? 1 : 0) - probe.blend) * Math.min(1, rdt * 10)
    const ub = probe.blend < 0.002 ? 0 : probe.blend > 0.998 ? 1 : probe.blend
    // 수면 ±0.6m 이내면 픽셀 분할, 1.2m 밖에서는 기존 전체 블렌드
    const split = 1 - THREE.MathUtils.smoothstep(Math.abs(depth), 0.6, 1.2)
    // 해저는 수중/수면 근처에서만 보임 (위에서는 불투명 수면이 가리고, 수면 셰이더가 굴절 해저를 직접 그림)
    seabed.m.visible = ub > 0 || split > 0; island.uniforms.uBedOn.value = seabed.m.visible ? 1 : 0
    ocean.uniforms.uSnap.value.set(Math.round(camera.position.x / 2.5) * 2.5, Math.round(camera.position.z / 2.5) * 2.5)
    for (const m of [ocean, sky, island]) { m.uniforms.uUnderG.value = ub; m.uniforms.uSplit.value = split; m.uniforms.uCamDepth.value = Math.max(depth, 0) }
    ;(window as any).__under = { h: probe.h, under: probe.under, blend: ub, split }
    a.t += rdt; a.n++; a.mx = Math.max(a.mx, rdt)
    if (a.t > 0.5) { fps(a.n / a.t, (a.t * 1000) / a.n, a.mx * 1000); a.t = 0; a.n = 0; a.mx = 0 }
  }, -1)
  return <>
    <mesh ref={skyRef} material={sky} frustumCulled={false} renderOrder={-1}><sphereGeometry args={[40000, 64, 32]} /></mesh>
    <mesh geometry={grid.geo} material={ocean} frustumCulled={false} />
    <directionalLight ref={sunRef} />
    <hemisphereLight ref={hemiRef} />
    <Island mat={island} />
    <mesh geometry={seabed.g} material={seabed.m} frustumCulled={false} />
    <group ref={cubeGroup} />
    <ambientLight intensity={0.9} />
  </>
}

// 정보 아이콘 + 포털 툴팁 (뷰포트 안으로 flip/shift, 잘림 없음)
function Info({ k }: { k: string }) {
  const ref = useRef<HTMLSpanElement>(null), tip = useRef<HTMLDivElement>(null)
  const [r, setR] = useState<DOMRect | null>(null), [pos, setPos] = useState({ x: -9999, y: -9999 })
  useLayoutEffect(() => {
    if (!r || !tip.current) return
    const t = tip.current.getBoundingClientRect(), m = 8, W = window.innerWidth, H = window.innerHeight
    let x = r.left - t.width - m                         // 기본: 왼쪽 (패널이 화면 오른쪽)
    if (x < m) x = r.right + m                           // flip
    x = Math.min(Math.max(m, x), W - m - t.width)        // shift
    let y = r.top + r.height / 2 - t.height / 2
    y = Math.min(Math.max(m, y), H - m - t.height)
    setPos({ x, y })
  }, [r])
  const text = INFO[k]; if (!text) return null
  const show = () => ref.current && setR(ref.current.getBoundingClientRect())
  const hide = () => { setR(null); setPos({ x: -9999, y: -9999 }) }
  return <span ref={ref} data-info={k} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} tabIndex={0}
    onClick={(e) => { e.preventDefault(); e.stopPropagation() }} className="inline-flex shrink-0 cursor-help text-neutral-500 outline-none hover:text-neutral-100">
    <InfoIcon size={12} strokeWidth={2} />
    {r && createPortal(<div ref={tip} role="tooltip" style={{ left: pos.x, top: pos.y }}
      className="pointer-events-none fixed z-[10000] w-max max-w-[260px] whitespace-normal break-keep rounded bg-neutral-800 px-2.5 py-2 text-[11px] leading-snug text-neutral-100 ring-1 ring-white/15">{text}</div>, document.body)}
  </span>
}
function Section({ title, info, open: o = false, children }: { title: string; info?: string; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(o)
  return <div className="mb-1.5 overflow-hidden rounded-md border border-white/10 last:mb-0">
    <div className={`flex items-center gap-1.5 bg-neutral-700/70 px-2.5 py-2 hover:bg-neutral-700 ${open ? 'border-b border-white/15' : ''}`}>
      <button onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-1.5 text-left text-[12px] font-bold text-white">
        <ChevronRight size={14} className={`shrink-0 text-neutral-300 transition-transform ${open ? 'rotate-90' : ''}`} /><span>{title}</span></button>
      {info && <Info k={info} />}
    </div>
    {open && <div className="space-y-2 bg-neutral-950/60 px-2.5 py-2.5">{children}</div>}
  </div>
}
function Row({ label, info, children }: { label: string; info?: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-300"><span className="flex items-center gap-1">{label}{info && <Info k={info} />}</span>{children}</div>
}
function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="flex gap-1 text-[11px]">{options.map(([v, l]) =>
    <button key={String(v)} onClick={() => onChange(v)} className={`flex-1 rounded-sm px-1.5 py-1 ${value === v ? 'bg-neutral-200 text-neutral-900' : 'bg-white/10 text-neutral-200 hover:bg-white/20'}`}>{l}</button>)}</div>
}
const btn = 'flex-1 rounded-sm bg-white/10 px-2 py-1 text-[11px] text-neutral-200 hover:bg-white/20'
function Slider(p: { label: string; info?: string; min: number; max: number; step: number; value: number; unit?: string; onChange: (v: number) => void }) {
  return <div className="block">
    <div className="flex justify-between text-[11px] text-neutral-300"><span className="flex items-center gap-1">{p.label}{p.info && <Info k={p.info} />}</span><span className="tabular-nums text-neutral-100">{p.value.toFixed(p.step < 1 ? (p.step < 0.1 ? 2 : 1) : 0)}{p.unit}</span></div>
    <input type="range" className="w-full" style={{ ['--p' as string]: `${((p.value - p.min) / (p.max - p.min)) * 100}%` }} min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(+e.target.value)} />
  </div>
}

export default function App() {
  const [params, setParams] = useState<OceanParams>({ wind: +(qs.get('wind') ?? 9), peak: +(qs.get('peak') ?? 60), choppy: 1.3, windDir: -1.9, hour: +(qs.get('hour') ?? 15.5), clouds: +(qs.get('clouds') ?? 0.3) })
  const [quality, setQuality] = useState<Quality>((qs.get('q') as Quality) ?? 'high')
  const [dpr, setDpr] = useState(+(qs.get('dpr') ?? Math.min(window.devicePixelRatio, 2)))
  const [look, setLook] = useState<WaterLook>(WATER_PRESETS['열대 맑은 물'])
  const setL = (k: keyof WaterLook) => (v: number | string) => setLook((p) => ({ ...p, [k]: v }))
  const [shore, setShore] = useState<ShoreLook>(SHORE_DEFAULT)
  const [under, setUnder] = useState<UnderLook>(UNDER_DEFAULT)
  const [cube, setCube] = useState<CubeCfg>({ size: 1.5, density: 0.5, add: +(qs.get('cubes') ?? 1), reset: 0, caustics: true })
  const setS = (k: keyof ShoreLook) => (v: number | string) => setShore((p) => ({ ...p, [k]: v }))
  const fpsEl = useRef<HTMLSpanElement>(null)
  const [perf, setPerf] = useState<Perf>({ n: PERF_Q[(qs.get('q') as Quality) ?? 'high'] ?? PERF_Q.high, mode: (qs.get('upd') as UpdateMode) ?? 'every', nth: 2, detail: +(qs.get('detail') ?? 600), dprCap: 2, dyn: false, target: 50, probeCube: 3, probeIdle: 8 })
  const setP = <K extends keyof Perf>(k: K) => (v: Perf[K]) => setPerf((p) => ({ ...p, [k]: v }))
  const perfRef = useRef(perf); perfRef.current = perf
  const [dynDpr, setDynDpr] = useState(dpr)
  const dprEl = useRef<HTMLSpanElement>(null)
  const controls = useRef<any>(null)
  const set = (k: keyof OceanParams) => (v: number) => setParams((p) => ({ ...p, [k]: v }))
  const goCam = (k: keyof typeof CAMS) => {
    const c = controls.current; if (!c) return
    c.object.position.set(...CAMS[k].pos); c.target.set(...CAMS[k].target); c.update()
  }
  useEffect(() => { (window as any).__cam = goCam })
  const onFps = (n: number, ms: number, mx: number) => {
    (window as any).__fps = n; (window as any).__ms = ms
    if (fpsEl.current) fpsEl.current.textContent = `${n.toFixed(0)} FPS · ${ms.toFixed(1)} ms · 최대 ${mx.toFixed(0)} ms`
    const p = perfRef.current
    if (p.dyn) setDynDpr((d) => THREE.MathUtils.clamp(+(d + (n < p.target - 3 ? -0.1 : n > p.target + 8 ? 0.05 : 0)).toFixed(2), 0.5, p.dprCap))
  }
  const curDpr = perf.dyn ? Math.min(dynDpr, perf.dprCap) : Math.min(dpr, perf.dprCap)
  useEffect(() => { if (dprEl.current) dprEl.current.textContent = `DPR ${curDpr.toFixed(2)}` })
  const cam0 = CAMS[(qs.get('cam') as keyof typeof CAMS) ?? 'low'] ?? CAMS.low
  return <div className="fixed inset-0">
    <Canvas dpr={curDpr} gl={{ antialias: true, powerPreference: 'high-performance' }} camera={{ position: [...cam0.pos], fov: 55, near: 0.3, far: 80000 }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.0 }}>
      <Scene params={params} look={look} shore={shore} under={under} quality={quality} fps={onFps} cube={cube} perf={perf} />
      <OrbitControls ref={controls} target={[...cam0.target]} enableDamping={false} maxPolarAngle={Math.PI * 0.9} minDistance={1} maxDistance={3000} />
    </Canvas>
    <div className="absolute left-3 top-3 rounded-sm bg-neutral-900/80 px-3 py-2 font-mono text-xs text-neutral-100">
      <span ref={fpsEl}>--</span> · <span ref={dprEl} /> · WebGL2 · GPU FFT
    </div>
    <div className="absolute right-3 top-3 w-72 max-h-[calc(100vh-24px)] overflow-y-auto rounded-sm bg-neutral-900/85 px-3 py-1 text-white">
      <div className="py-2 text-sm font-semibold text-neutral-100">바다 설정</div>
      <Section title="외해 파도 · 거품" info="sec.wave" open>
        <Slider label="풍속" info="wind" min={1} max={25} step={0.5} value={params.wind} unit=" m/s" onChange={set('wind')} />
        <Slider label="피크 파장" info="peak" min={8} max={200} step={1} value={params.peak} unit=" m" onChange={set('peak')} />
        <Slider label="초퍼니스" info="choppy" min={0} max={2} step={0.05} value={params.choppy} onChange={set('choppy')} />
        <Slider label="풍향" info="windDir" min={-3.14} max={3.14} step={0.01} value={params.windDir} onChange={set('windDir')} />
        <Slider label="파도 뾰족함" info="sharp" min={0} max={1} step={0.05} value={shore.sharp} onChange={setS('sharp')} />
        <Slider label="물살 거품 양" info="collFoam" min={0} max={2} step={0.05} value={shore.collFoam} onChange={setS('collFoam')} />
        <Slider label="거품 지속 시간" info="persist" min={0.3} max={4} step={0.1} value={shore.persist} unit="x" onChange={setS('persist')} />
      </Section>
      <Section title="하늘 · 시간" info="sec.sky">
        <Slider label="시간" info="hour" min={5.5} max={18.5} step={0.1} value={params.hour} unit=" 시" onChange={set('hour')} />
        <Slider label="구름 양" info="clouds" min={0} max={1} step={0.05} value={params.clouds} onChange={set('clouds')} />
      </Section>
      <Section title="물빛 · 탁도" info="sec.look">
        <Row label="프리셋" info="preset"><span /></Row>
        <div className="flex gap-1">{Object.entries(WATER_PRESETS).map(([k, v]) => <button key={k} onClick={() => setLook(v)} className={btn}>{k}</button>)}</div>
        <Row label="깊은 물 색" info="deep"><input type="color" value={look.deep} onChange={(e) => setL('deep')(e.target.value)} className="h-6 w-10 bg-transparent" /></Row>
        <Row label="얕은 물 색" info="shallow"><input type="color" value={look.shallow} onChange={(e) => setL('shallow')(e.target.value)} className="h-6 w-10 bg-transparent" /></Row>
        <Slider label="탁도" info="turbidity" min={0} max={1} step={0.01} value={look.turbidity} onChange={setL('turbidity')} />
        <Slider label="투명 거리" info="clarity" min={2} max={60} step={1} value={look.clarity} unit=" m" onChange={setL('clarity')} />
        <Slider label="해저 깊이" info="depth" min={3} max={40} step={0.5} value={look.depth} unit=" m" onChange={setL('depth')} />
      </Section>
      <Section title="해안" info="sec.shore">
        <Slider label="해안 거품" info="shoreFoam" min={0} max={2} step={0.05} value={shore.shoreFoam} onChange={setS('shoreFoam')} />
        <Slider label="해안 파도 세기" info="shoreWave" min={0} max={2} step={0.05} value={shore.shoreWave} unit=" m" onChange={setS('shoreWave')} />
        <Slider label="해안 파장" info="shoreLen" min={6} max={40} step={1} value={shore.shoreLen} unit=" m" onChange={setS('shoreLen')} />
        <Row label="거품 색" info="foamColor"><input type="color" value={shore.foamColor} onChange={(e) => setS('foamColor')(e.target.value)} className="h-6 w-10 bg-transparent" /></Row>
        <Slider label="거품 밝기" info="foamBright" min={0.3} max={2} step={0.05} value={shore.foamBright} onChange={setS('foamBright')} />
      </Section>
      <Section title="수중" info="sec.under">
        <Row label="수중 색" info="uwColor"><input type="color" value={under.color} onChange={(e) => setUnder((p) => ({ ...p, color: e.target.value }))} className="h-6 w-10 bg-transparent" /></Row>
        <Slider label="수중 밀도" info="uwDensity" min={0.01} max={0.4} step={0.01} value={under.density} unit=" /m" onChange={(v) => setUnder((p) => ({ ...p, density: v }))} />
      </Section>
      <Section title="부유 큐브 · 해저" info="sec.cube">
        <Row label="큐브" info="cubeAdd"><span className="text-neutral-400">{Math.min(cube.add, 10)}개</span></Row>
        <div className="flex gap-1">
          <button onClick={() => setCube((p) => ({ ...p, add: p.add + 1 }))} className={btn}>큐브 추가</button>
          <button onClick={() => setCube((p) => ({ ...p, reset: p.reset + 1, add: 0 }))} className={btn}>초기화</button>
        </div>
        <Slider label="큐브 크기" info="cubeSize" min={0.3} max={4} step={0.1} value={cube.size} unit=" m" onChange={(v) => setCube((p) => ({ ...p, size: v }))} />
        <Slider label="밀도(흘수)" info="cubeDensity" min={0.1} max={0.95} step={0.05} value={cube.density} onChange={(v) => setCube((p) => ({ ...p, density: v }))} />
        <Row label="해저 커스틱" info="caustics"><input type="checkbox" checked={cube.caustics} onChange={(e) => setCube((p) => ({ ...p, caustics: e.target.checked }))} /></Row>
      </Section>
      <Section title="성능" info="sec.perf">
        <Row label="품질 프리셋" info="quality"><span /></Row>
        <Seg value={quality} options={[['low', '낮음'], ['medium', '보통'], ['high', '높음']]} onChange={(k) => { setQuality(k); setPerf((p) => ({ ...p, n: PERF_Q[k] })) }} />
        <Row label="FFT 해상도 · 원거리" info="fft0"><span /></Row>
        <Seg value={perf.n[0]} options={[[128, '128'], [256, '256'], [512, '512']]} onChange={(v) => setPerf((p) => { const n = [...p.n] as Perf['n']; n[0] = v; return { ...p, n } })} />
        <Row label="FFT 해상도 · 중간" info="fft1"><span /></Row>
        <Seg value={perf.n[1]} options={[[128, '128'], [256, '256'], [512, '512']]} onChange={(v) => setPerf((p) => { const n = [...p.n] as Perf['n']; n[1] = v; return { ...p, n } })} />
        <Row label="FFT 해상도 · 근거리" info="fft2"><span /></Row>
        <Seg value={perf.n[2]} options={[[128, '128'], [256, '256'], [512, '512']]} onChange={(v) => setPerf((p) => { const n = [...p.n] as Perf['n']; n[2] = v; return { ...p, n } })} />
        <Row label="캐스케이드 갱신" info="mode"><span /></Row>
        <Seg value={perf.mode} options={[['every', '매 프레임'], ['alt', '교대'], ['nth', 'N프레임마다']]} onChange={setP('mode')} />
        {perf.mode === 'nth' && <Slider label="N" info="nth" min={2} max={6} step={1} value={perf.nth} unit=" 프레임" onChange={setP('nth')} />}
        <Slider label="디테일 거리" info="detail" min={50} max={3000} step={50} value={perf.detail} unit=" m" onChange={setP('detail')} />
        <Slider label="픽셀 비율" info="dpr" min={0.5} max={2} step={0.25} value={dpr} onChange={setDpr} />
        <Slider label="DPR 상한" info="dprCap" min={0.5} max={2} step={0.25} value={perf.dprCap} onChange={setP('dprCap')} />
        <Row label="동적 해상도" info="dyn"><input type="checkbox" checked={perf.dyn} onChange={(e) => { setDynDpr(Math.min(dpr, perf.dprCap)); setP('dyn')(e.target.checked) }} /></Row>
        {perf.dyn && <Slider label="목표 FPS" info="target" min={30} max={120} step={5} value={perf.target} onChange={setP('target')} />}
        <Slider label="파고 읽기 간격 (큐브 있음)" info="probeCube" min={1} max={12} step={1} value={perf.probeCube} unit=" 프레임" onChange={setP('probeCube')} />
        <Slider label="파고 읽기 간격 (큐브 없음)" info="probeIdle" min={1} max={30} step={1} value={perf.probeIdle} unit=" 프레임" onChange={setP('probeIdle')} />
      </Section>
      <Section title="카메라" info="sec.cam">
        <div className="grid grid-cols-2 gap-1">{([["low","수면"],["high","상공"],["shore","해안"],["top","위에서"],["waterline","수면선(반반)"],["under","수중"],["underUp","수중→위"],["floor","해저"]] as [keyof typeof CAMS, string][]).map(([k, l]) =>
          <button key={k} onClick={() => goCam(k)} className={btn}>{l}</button>)}</div>
      </Section>
    </div>
  </div>
}
