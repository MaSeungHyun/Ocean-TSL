import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { FFTOcean } from './fft'
import { CASCADE_L, CASCADE_OFF, CASCADE_ROT, skyState, WATER_PRESETS, SHORE_DEFAULT, bakeShore, islandHeight, type OceanParams, type WaterLook, type ShoreLook } from './spectrum'
import { common, islandFS, oceanFS, oceanVSBody, skyFS } from './glsl'

type Quality = 'low' | 'medium' | 'high'
// N: FFT 해상도, rings: 방사형 그리드 링 수 (정점 밀도)
const Q: Record<Quality, { N: number; rings: number }> = { low: { N: 256, rings: 420 }, medium: { N: 256, rings: 640 }, high: { N: 512, rings: 900 } }
const qs = new URLSearchParams(location.search)
const CAMS = { low: { pos: [0, 2.2, 0], target: [-40, 1.2, -120] }, high: { pos: [140, 160, 260], target: [-120, 0, -420] }, shore: { pos: [-225, 7, -525], target: [-262, 0, -612] }, top: { pos: [-262, 22, -548], target: [-262, 0, -556] } } as const
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
  uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uClouds: { value: 0 }, uCam: { value: new THREE.Vector3() } })

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

function Scene({ params, look, shore, quality, fps }: { params: OceanParams; look: WaterLook; shore: ShoreLook; quality: Quality; fps: (n: number) => void }) {
  const { camera, gl } = useThree()
  const q = Q[quality]
  const grid = useMemo(() => radialGrid(q.rings), [q.rings])
  const sim = useMemo(() => new FFTOcean(q.N, Math.min(16, gl.capabilities.getMaxAnisotropy())), [q.N, gl])
  useEffect(() => () => sim.dispose(), [sim])
  const ocean = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { ...skyU(), uTimeV: { value: 0 }, uCamV: { value: new THREE.Vector3() }, uOffset: { value: new THREE.Vector2() }, uG: { value: grid.g },
      uDisp0: { value: null }, uDisp1: { value: null }, uDisp2: { value: null }, uDer0: { value: null }, uDer1: { value: null }, uDer2: { value: null },
      uL: { value: new THREE.Vector3(...CASCADE_L) }, uRot: { value: new THREE.Vector3(...CASCADE_ROT) },
      uOff01: { value: new THREE.Vector4(...CASCADE_OFF[0], ...CASCADE_OFF[1]) }, uOff2: { value: new THREE.Vector2(...CASCADE_OFF[2]) },
      uIsland: { value: ISLAND }, uHs: { value: 1 }, uTexN: { value: q.N },
      uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uTurb: { value: 0 }, uClarity: { value: 20 }, uDepth: { value: 10 },
      uShore: { value: shoreTex }, uShoreRect: { value: new THREE.Vector3(...SHORE.rect) }, uShoreA: { value: 0.6 }, uShoreLen: { value: 16 },
      uShoreFoam: { value: 1 }, uSharp: { value: 0.6 }, uCollFoam: { value: 1 }, uFoamCol: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: `precision highp float;\n${oceanVSBody}\nvoid main(){ vec3 w = oceanDisplace(position); gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
    fragmentShader: toneOut(oceanFS), side: THREE.DoubleSide, transparent: true,
  }), [grid.g, q.N])
  const sky = useMemo(() => new THREE.ShaderMaterial({ uniforms: skyU(), side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: toneOut(skyFS) }), [])
  void common
  const island = useMemo(() => new THREE.ShaderMaterial({ uniforms: { ...skyU(), uShoreA: { value: 0.6 } }, vertexColors: true,
    vertexShader: `varying vec3 vCol; varying vec3 vN; varying vec3 vWp;
void main(){ vec4 w = modelMatrix*vec4(position,1.0); vWp = w.xyz; vN = normalize(mat3(modelMatrix)*normal); vCol = color; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: toneOut(islandFS) }), [])
  const skyRef = useRef<THREE.Mesh>(null!)
  const sunRef = useRef<THREE.DirectionalLight>(null!)
  const hemiRef = useRef<THREE.HemisphereLight>(null!)
  const acc = useRef({ t: 0, n: 0, time: 0 })
  // 스펙트럼 재계산은 슬라이더 조작 중 끊김을 줄이려고 짧게 디바운스
  useEffect(() => { const id = setTimeout(() => { sim.setParams(params); ocean.uniforms.uHs.value = sim.hs }, 60); return () => clearTimeout(id) },
    [sim, ocean, params.wind, params.peak, params.choppy, params.windDir])
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
  }, [ocean, look])
  useEffect(() => {
    const u = ocean.uniforms
    u.uShoreA.value = island.uniforms.uShoreA.value = shore.shoreWave; u.uShoreLen.value = shore.shoreLen; u.uShoreFoam.value = shore.shoreFoam
    u.uSharp.value = shore.sharp; u.uCollFoam.value = shore.collFoam; sim.setFoam(shore.collFoam, shore.persist)
    u.uFoamCol.value.set(shore.foamColor).multiplyScalar(shore.foamBright)
  }, [ocean, island, sim, shore])
  useFrame((_, rdt) => {
    const dt = Math.min(rdt, 0.1), a = acc.current; a.time += dt
    const cur = sim.update(gl, a.time, dt)
    const u = ocean.uniforms
    for (let c = 0; c < 3; c++) { u[`uDisp${c}`].value = sim.disp[c][cur].texture; u[`uDer${c}`].value = sim.deriv[c].texture }
    u.uTime.value = u.uTimeV.value = a.time; sky.uniforms.uTime.value = island.uniforms.uTime.value = a.time; island.uniforms.uCam.value.copy(camera.position)
    u.uCam.value.copy(camera.position); u.uCamV.value.copy(camera.position); sky.uniforms.uCam.value.copy(camera.position)
    u.uOffset.value.set(camera.position.x, camera.position.z)
    skyRef.current.position.copy(camera.position)
    a.t += rdt; a.n++
    if (a.t > 0.5) { fps(a.n / a.t); a.t = 0; a.n = 0 }
  }, -1)
  return <>
    <mesh ref={skyRef} material={sky} frustumCulled={false} renderOrder={-1}><sphereGeometry args={[40000, 64, 32]} /></mesh>
    <mesh geometry={grid.geo} material={ocean} frustumCulled={false} />
    <directionalLight ref={sunRef} />
    <hemisphereLight ref={hemiRef} />
    <Island mat={island} />
  </>
}

function Slider(p: { label: string; min: number; max: number; step: number; value: number; unit?: string; onChange: (v: number) => void }) {
  return <label className="block">
    <div className="flex justify-between text-[11px] text-slate-300"><span>{p.label}</span><span className="tabular-nums text-sky-300">{p.value.toFixed(p.step < 1 ? (p.step < 0.1 ? 2 : 1) : 0)}{p.unit}</span></div>
    <input type="range" className="w-full" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(+e.target.value)} />
  </label>
}

export default function App() {
  const [params, setParams] = useState<OceanParams>({ wind: +(qs.get('wind') ?? 9), peak: +(qs.get('peak') ?? 60), choppy: 1.3, windDir: -1.9, hour: +(qs.get('hour') ?? 15.5), clouds: +(qs.get('clouds') ?? 0.3) })
  const [quality, setQuality] = useState<Quality>((qs.get('q') as Quality) ?? 'high')
  const [dpr, setDpr] = useState(+(qs.get('dpr') ?? Math.min(window.devicePixelRatio, 2)))
  const [look, setLook] = useState<WaterLook>(WATER_PRESETS['열대 맑은 물'])
  const setL = (k: keyof WaterLook) => (v: number | string) => setLook((p) => ({ ...p, [k]: v }))
  const [shore, setShore] = useState<ShoreLook>(SHORE_DEFAULT)
  const setS = (k: keyof ShoreLook) => (v: number | string) => setShore((p) => ({ ...p, [k]: v }))
  const fpsEl = useRef<HTMLSpanElement>(null)
  const controls = useRef<any>(null)
  const set = (k: keyof OceanParams) => (v: number) => setParams((p) => ({ ...p, [k]: v }))
  const goCam = (k: keyof typeof CAMS) => {
    const c = controls.current; if (!c) return
    c.object.position.set(...CAMS[k].pos); c.target.set(...CAMS[k].target); c.update()
  }
  useEffect(() => { (window as any).__cam = goCam })
  const onFps = (n: number) => { (window as any).__fps = n; if (fpsEl.current) fpsEl.current.textContent = n.toFixed(0) }
  const cam0 = CAMS[(qs.get('cam') as keyof typeof CAMS) ?? 'low'] ?? CAMS.low
  return <div className="fixed inset-0">
    <Canvas dpr={dpr} gl={{ antialias: true, powerPreference: 'high-performance' }} camera={{ position: [...cam0.pos], fov: 55, near: 0.3, far: 80000 }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.0 }}>
      <Scene params={params} look={look} shore={shore} quality={quality} fps={onFps} />
      <OrbitControls ref={controls} target={[...cam0.target]} enableDamping maxPolarAngle={Math.PI * 0.495} minDistance={1} maxDistance={3000} />
    </Canvas>
    <div className="absolute left-3 top-3 rounded-lg bg-black/45 px-3 py-2 font-mono text-xs text-white backdrop-blur">
      <span ref={fpsEl}>--</span> FPS · WebGL2 · GPU FFT
    </div>
    <div className="absolute right-3 top-3 w-64 max-h-[calc(100vh-24px)] overflow-y-auto space-y-2 rounded-xl border border-white/10 bg-slate-900/60 p-3 text-white shadow-xl backdrop-blur-md">
      <div className="text-sm font-semibold">Ocean · R3F + FFT</div>
      <Slider label="풍속 Wind" min={1} max={25} step={0.5} value={params.wind} unit=" m/s" onChange={set('wind')} />
      <Slider label="피크 파장 Peak λ" min={8} max={200} step={1} value={params.peak} unit=" m" onChange={set('peak')} />
      <Slider label="초퍼니스 Choppy" min={0} max={2} step={0.05} value={params.choppy} onChange={set('choppy')} />
      <Slider label="풍향 Wind dir" min={-3.14} max={3.14} step={0.01} value={params.windDir} onChange={set('windDir')} />
      <Slider label="시간 Time of day" min={5.5} max={18.5} step={0.1} value={params.hour} unit=" h" onChange={set('hour')} />
      <Slider label="구름 Cloud coverage" min={0} max={1} step={0.05} value={params.clouds} onChange={set('clouds')} />
      <div className="border-t border-white/10 pt-2 text-[11px] font-semibold text-slate-200">물빛 · 탁도</div>
      <div className="flex gap-1 text-[11px]">{Object.entries(WATER_PRESETS).map(([k, v]) =>
        <button key={k} onClick={() => setLook(v)} className="flex-1 rounded bg-white/10 px-1 py-1 hover:bg-white/20">{k}</button>)}</div>
      <div className="flex gap-2 text-[11px] text-slate-300">
        <label className="flex flex-1 items-center justify-between">깊은 물 <input type="color" value={look.deep} onChange={(e) => setL('deep')(e.target.value)} className="h-6 w-10 bg-transparent" /></label>
        <label className="flex flex-1 items-center justify-between">얕은 물 <input type="color" value={look.shallow} onChange={(e) => setL('shallow')(e.target.value)} className="h-6 w-10 bg-transparent" /></label>
      </div>
      <Slider label="탁도 Turbidity" min={0} max={1} step={0.01} value={look.turbidity} onChange={setL('turbidity')} />
      <Slider label="투명 거리 Clarity" min={2} max={60} step={1} value={look.clarity} unit=" m" onChange={setL('clarity')} />
      <Slider label="해저 깊이 Seabed depth" min={3} max={40} step={0.5} value={look.depth} unit=" m" onChange={setL('depth')} />
      <div className="border-t border-white/10 pt-2 text-[11px] font-semibold text-slate-200">해안 · 거품</div>
      <Slider label="해안 거품 Shore foam" min={0} max={2} step={0.05} value={shore.shoreFoam} onChange={setS('shoreFoam')} />
      <Slider label="해안 파도 세기 Shore waves" min={0} max={2} step={0.05} value={shore.shoreWave} unit=" m" onChange={setS('shoreWave')} />
      <Slider label="해안 파장 Shore wavelength" min={6} max={40} step={1} value={shore.shoreLen} unit=" m" onChange={setS('shoreLen')} />
      <div className="flex items-center gap-2 text-[11px] text-slate-300">
        <label className="flex flex-1 items-center justify-between">거품 색 <input type="color" value={shore.foamColor} onChange={(e) => setS('foamColor')(e.target.value)} className="h-6 w-10 bg-transparent" /></label>
      </div>
      <Slider label="거품 밝기 Foam brightness" min={0.3} max={2} step={0.05} value={shore.foamBright} onChange={setS('foamBright')} />
      <div className="border-t border-white/10 pt-2 text-[11px] font-semibold text-slate-200">외해 파도 · 거품</div>
      <Slider label="파도 뾰족함 Crest sharpness" min={0} max={1} step={0.05} value={shore.sharp} onChange={setS('sharp')} />
      <Slider label="물살 거품 양 Collision foam" min={0} max={2} step={0.05} value={shore.collFoam} onChange={setS('collFoam')} />
      <Slider label="거품 지속 시간 Foam persistence" min={0.3} max={4} step={0.1} value={shore.persist} unit="x" onChange={setS('persist')} />
      <Slider label="픽셀 비율 Pixel ratio" min={0.5} max={2} step={0.25} value={dpr} onChange={setDpr} />
      <div className="flex gap-1 text-xs">{(['low', 'medium', 'high'] as Quality[]).map((k) =>
        <button key={k} onClick={() => setQuality(k)} className={`flex-1 rounded px-2 py-1 ${quality === k ? 'bg-sky-500' : 'bg-white/10 hover:bg-white/20'}`}>{k}</button>)}</div>
      <div className="flex gap-1 text-xs">
        <button onClick={() => goCam('low')} className="flex-1 rounded bg-white/10 px-2 py-1 hover:bg-white/20">수면 시점</button>
        <button onClick={() => goCam('high')} className="flex-1 rounded bg-white/10 px-2 py-1 hover:bg-white/20">상공 시점</button>
      </div>
    </div>
  </div>
}
