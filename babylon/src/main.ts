import './style.css'
import { Engine, Scene, RawTexture, Constants, ArcRotateCamera, Vector3, Vector2, Vector4, Color3, Mesh, MeshBuilder, VertexData, ShaderMaterial,
  StandardMaterial, HemisphericLight, DirectionalLight, DefaultRenderingPipeline, ImageProcessingConfiguration, Effect } from '@babylonjs/core'
import { CASCADE_L, CASCADE_OFF, CASCADE_ROT, skyState, WATER_PRESETS, SHORE_DEFAULT, bakeShore, islandHeight, type OceanParams, type WaterLook, type ShoreLook } from './spectrum'
import { islandFS, oceanFS, oceanVSBody, skyFS } from './glsl'
import { FFTOcean } from './fft'

const skyVS = `precision highp float; attribute vec3 position; uniform mat4 world; uniform mat4 viewProjection; varying vec3 vW;
void main(){ vec4 w=world*vec4(position,1.0); vW=w.xyz; gl_Position=viewProjection*w; }`
const oceanVS = `precision highp float; attribute vec3 position; uniform mat4 viewProjection;
${oceanVSBody}
void main(){ vec3 w = oceanDisplace(position); gl_Position = viewProjection*vec4(w, 1.0); }`

type Quality = 'low' | 'medium' | 'high'
// N: FFT 해상도, rings: 방사형 그리드 링 수
const Q: Record<Quality, { N: number; rings: number }> = { low: { N: 256, rings: 420 }, medium: { N: 256, rings: 640 }, high: { N: 512, rings: 900 } }
const qs = new URLSearchParams(location.search)
const CAMS = { low: { pos: [0, 2.2, 0], target: [-40, 1.2, -120] }, high: { pos: [140, 160, 260], target: [-120, 0, -420] }, shore: { pos: [-225, 7, -525], target: [-262, 0, -612] }, top: { pos: [-262, 22, -548], target: [-262, 0, -556] } } as const

const canvas = document.getElementById('c') as HTMLCanvasElement
const engine = new Engine(canvas, true, { stencil: true, antialias: true, powerPreference: 'high-performance' })
let dpr = +(qs.get('dpr') ?? Math.min(devicePixelRatio, 2))
engine.setHardwareScalingLevel(1 / dpr)
const scene = new Scene(engine)
const cam = new ArcRotateCamera('cam', 0, 1, 10, Vector3.Zero(), scene)
cam.minZ = 0.3; cam.maxZ = 80000; cam.fov = 55 * Math.PI / 180; cam.lowerRadiusLimit = 1; cam.upperRadiusLimit = 3000
cam.upperBetaLimit = Math.PI * 0.495; cam.wheelPrecision = 2; cam.panningSensibility = 50
cam.attachControl(canvas, true)
const goCam = (k: keyof typeof CAMS) => { cam.setTarget(new Vector3(...CAMS[k].target)); cam.setPosition(new Vector3(...CAMS[k].pos)) }
goCam((qs.get('cam') as keyof typeof CAMS) ?? 'low')

const params: OceanParams = { wind: +(qs.get('wind') ?? 9), peak: +(qs.get('peak') ?? 60), choppy: 1.3, windDir: -1.9, hour: +(qs.get('hour') ?? 15.5), clouds: +(qs.get('clouds') ?? 0.3) }
let quality: Quality = (qs.get('q') as Quality) ?? 'high'
const island = new Vector3(-260, -720, 150)

Effect.ShadersStore['skyVertexShader'] = skyVS
Effect.ShadersStore['skyFragmentShader'] = skyFS
const skyUniforms = ['world', 'viewProjection', 'uTime', 'uSun', 'uSunColor', 'uSunI', 'uZenith', 'uHorizon', 'uClouds', 'uCam']
const skyMat = new ShaderMaterial('sky', scene, 'sky', { attributes: ['position'], uniforms: skyUniforms })
skyMat.backFaceCulling = false; skyMat.disableDepthWrite = true
const skyMesh = MeshBuilder.CreateSphere('sky', { diameter: 80000, segments: 32 }, scene)
skyMesh.material = skyMat; skyMesh.infiniteDistance = true; skyMesh.renderingGroupId = 0

const sunL = new DirectionalLight('sun', new Vector3(0, -1, 0), scene)
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)

// 섬 (절차적) + 해안 거리장 베이크
const SHORE = bakeShore(512, 1000)
const shoreTex = new RawTexture(SHORE.data, SHORE.N, SHORE.N, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT)
shoreTex.wrapU = shoreTex.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE
Effect.ShadersStore['islandVertexShader'] = `precision highp float; attribute vec3 position; attribute vec3 normal; attribute vec4 color;
uniform mat4 world; uniform mat4 viewProjection; varying vec3 vCol; varying vec3 vN; varying vec3 vWp;
void main(){ vec4 w = world*vec4(position,1.0); vWp = w.xyz; vN = normalize(mat3(world)*normal); vCol = color.rgb; gl_Position = viewProjection*w; }`
Effect.ShadersStore['islandFragmentShader'] = islandFS
const islandMat = new ShaderMaterial('islm', scene, 'island', { attributes: ['position', 'normal', 'color'], uniforms: [...skyUniforms, 'uShoreA'] })
{
  const grid = MeshBuilder.CreateGround('isl', { width: 360, height: 360, subdivisions: 220, updatable: true }, scene)
  const q = grid.getVerticesData('position')!; const col: number[] = []
  for (let i = 0; i < q.length; i += 3) {
    const x = q[i], z = q[i + 2], h = islandHeight(x, z) + 3
    q[i + 1] = h
    const t = Math.min(1, Math.max(0, (h - 3) / 4))
    const sand = [0.76, 0.68, 0.5], green = [0.16, 0.3, 0.1], rock = [0.35, 0.33, 0.3]
    const c = h > 30 ? rock : sand.map((v, k) => v + (green[k] - v) * t); col.push(c[0], c[1], c[2], 1)
  }
  grid.updateVerticesData('position', q); grid.setVerticesData('color', col)
  const nrm: number[] = []; VertexData.ComputeNormals(q, grid.getIndices()!, nrm); grid.updateVerticesData('normal', nrm)
  grid.position.set(island.x, -3, island.y)
  grid.material = islandMat
}

function radialGrid(rings: number, rMin = 0.3, rMax = 26000) {
  const g = Math.log(rMax / rMin) / rings, seg = Math.max(64, Math.round((2 * Math.PI) / g))
  const pos: number[] = [0, 0, 0], idx: number[] = []
  for (let j = 0; j <= rings; j++) { const rr = rMin * Math.exp(j * g)
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2 + (j % 2) * (Math.PI / seg); pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr) } }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i)
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = 1 + j * seg + i, b = 1 + j * seg + ((i + 1) % seg), c = 1 + (j + 1) * seg + i, d = 1 + (j + 1) * seg + ((i + 1) % seg)
    idx.push(a, b, c, b, d, c) }
  const m = new Mesh('ocean', scene); const vd = new VertexData(); vd.positions = pos; vd.indices = idx; vd.applyToMesh(m)
  m.alwaysSelectAsActiveMesh = true
  return { m, g }
}

let ocean: { m: Mesh; g: number; mat: ShaderMaterial; sim: FFTOcean } | null = null
const aniso = Math.min(16, engine.getCaps().maxAnisotropy || 1)
function buildOcean() {
  ocean?.m.dispose(); ocean?.mat.dispose(); ocean?.sim.dispose()
  const q = Q[quality]; const { m, g } = radialGrid(q.rings)
  Effect.ShadersStore['oceanVertexShader'] = oceanVS
  Effect.ShadersStore['oceanFragmentShader'] = oceanFS
  const mat = new ShaderMaterial(`ocean_${quality}`, scene, 'ocean', { attributes: ['position'],
    uniforms: [...skyUniforms, 'uTimeV', 'uCamV', 'uOffset', 'uG', 'uL', 'uRot', 'uOff01', 'uOff2', 'uIsland', 'uHs', 'uTexN', 'uDeep', 'uShallow', 'uTurb', 'uClarity', 'uDepth', 'uShoreRect', 'uShoreA', 'uShoreLen', 'uShoreFoam', 'uFoamCol', 'uSharp', 'uCollFoam'],
    samplers: ['uShore', 'uDisp0', 'uDisp1', 'uDisp2', 'uDer0', 'uDer1', 'uDer2'] })
  mat.backFaceCulling = false
  mat.needAlphaBlending = () => true
  mat.setTexture('uShore', shoreTex); mat.setVector3('uShoreRect', new Vector3(...SHORE.rect))
  mat.setVector3('uL', new Vector3(...CASCADE_L)); mat.setVector3('uRot', new Vector3(...CASCADE_ROT))
  mat.setVector4('uOff01', new Vector4(...CASCADE_OFF[0], ...CASCADE_OFF[1])); mat.setVector2('uOff2', new Vector2(...CASCADE_OFF[2]))
  mat.setFloat('uG', g); mat.setFloat('uTexN', q.N); mat.setVector3('uIsland', island)
  const sim = new FFTOcean(engine, scene, q.N, aniso)
  m.material = mat; ocean = { m, g, mat, sim }; applySpectrum(); applySky(); applyLook(); applyShore()
}
const look: WaterLook = { ...WATER_PRESETS['열대 맑은 물'] }
function applyLook() {
  if (!ocean) return
  const mt = ocean.mat
  mt.setColor3('uDeep', Color3.FromHexString(look.deep).toLinearSpace()); mt.setColor3('uShallow', Color3.FromHexString(look.shallow).toLinearSpace())
  mt.setFloat('uTurb', look.turbidity); mt.setFloat('uClarity', look.clarity); mt.setFloat('uDepth', look.depth)
}
const shore: ShoreLook = { ...SHORE_DEFAULT }
function applyShore() {
  if (!ocean) return
  const mt = ocean.mat
  mt.setFloat('uShoreA', shore.shoreWave); islandMat.setFloat('uShoreA', shore.shoreWave); mt.setFloat('uShoreLen', shore.shoreLen); mt.setFloat('uShoreFoam', shore.shoreFoam); mt.setFloat('uSharp', shore.sharp); mt.setFloat('uCollFoam', shore.collFoam); ocean.sim.setFoam(shore.collFoam, shore.persist)
  mt.setColor3('uFoamCol', Color3.FromHexString(shore.foamColor).toLinearSpace().scale(shore.foamBright))
}
let specTimer = 0
function applySpectrum() {
  clearTimeout(specTimer)
  specTimer = setTimeout(() => { if (!ocean) return; ocean.sim.setParams(params); ocean.mat.setFloat('uHs', ocean.sim.hs) }, 60)
}
function applySky() {
  if (!ocean) return
  const s = skyState(params.hour, params.clouds)
  for (const mm of [ocean.mat, skyMat, islandMat]) {
    mm.setVector3('uSun', new Vector3(...s.sun)); mm.setColor3('uSunColor', new Color3(...s.sunColor)); mm.setFloat('uSunI', s.sunI)
    mm.setColor3('uZenith', new Color3(...s.zenith)); mm.setColor3('uHorizon', new Color3(...s.horizon)); mm.setFloat('uClouds', params.clouds)
  }
  sunL.direction = new Vector3(-s.sun[0], -s.sun[1], -s.sun[2]); sunL.diffuse = new Color3(...s.sunColor); sunL.intensity = s.sunI * 0.6
  hemi.diffuse = new Color3(...s.zenith); hemi.groundColor = new Color3(0.05, 0.08, 0.1); hemi.intensity = 0.8
}
buildOcean()

// 후처리: ACES 톤매핑 + 약한 블룸 + FXAA
const pipe = new DefaultRenderingPipeline('pp', true, scene, [cam])
pipe.imageProcessingEnabled = true
pipe.imageProcessing.toneMappingEnabled = true
pipe.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
pipe.imageProcessing.exposure = 1.0
pipe.fxaaEnabled = true
pipe.bloomEnabled = true; pipe.bloomThreshold = 1.2; pipe.bloomWeight = 0.25; pipe.bloomKernel = 48; pipe.bloomScale = 0.5
pipe.samples = 4

let time = 0, acc = 0, n = 0
const fpsEl = document.getElementById('fps')!
scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1); time += dt
  const c = cam.position
  if (ocean) {
    const cur = ocean.sim.update(time, dt), mt = ocean.mat
    if (cur >= 0) for (let i = 0; i < 3; i++) { mt.setTexture(`uDisp${i}`, ocean.sim.disp[i][cur].t); mt.setTexture(`uDer${i}`, ocean.sim.deriv[i].t) }
    mt.setVector2('uOffset', new Vector2(c.x, c.z)); mt.setFloat('uTime', time); mt.setFloat('uTimeV', time); mt.setVector3('uCam', c); mt.setVector3('uCamV', c)
  }
  islandMat.setFloat('uTime', time); islandMat.setVector3('uCam', c)
  skyMat.setFloat('uTime', time); skyMat.setVector3('uCam', c)
  acc += dt; n++; if (acc > 0.5) { const f = n / acc; (window as any).__fps = f; fpsEl.textContent = f.toFixed(0); acc = 0; n = 0 }
})
engine.runRenderLoop(() => scene.render())
addEventListener('resize', () => engine.resize())

// ---- Tailwind 패널
const panel = document.getElementById('panel')!
function slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, unit = '') {
  const el = document.createElement('label'); el.className = 'block'
  const dig = step < 1 ? (step < 0.1 ? 2 : 1) : 0
  el.innerHTML = `<div class="flex justify-between text-[11px] text-slate-300"><span>${label}</span><span class="tabular-nums text-sky-300"></span></div><input type="range" class="w-full" min="${min}" max="${max}" step="${step}">`
  const out = el.querySelector('span:last-child')!, inp = el.querySelector('input')!
  inp.value = String(get()); out.textContent = get().toFixed(dig) + unit
  inp.oninput = () => { set(+inp.value); out.textContent = (+inp.value).toFixed(dig) + unit }
  panel.appendChild(el)
}
const P = (k: keyof OceanParams) => [() => params[k], (v: number) => { params[k] = v; if (k === 'hour' || k === 'clouds') applySky(); else applySpectrum() }] as const
slider('풍속 Wind', 1, 25, 0.5, ...P('wind'), ' m/s')
slider('피크 파장 Peak λ', 8, 200, 1, ...P('peak'), ' m')
slider('초퍼니스 Choppy', 0, 2, 0.05, ...P('choppy'))
slider('풍향 Wind dir', -3.14, 3.14, 0.01, ...P('windDir'))
slider('시간 Time of day', 5.5, 18.5, 0.1, ...P('hour'), ' h')
slider('구름 Cloud coverage', 0, 1, 0.05, ...P('clouds'))
{ const h = document.createElement('div'); h.className = 'border-t border-white/10 pt-2 text-[11px] font-semibold text-slate-200'; h.textContent = '물빛 · 탁도'; panel.appendChild(h) }
const presetRow = document.createElement('div'); presetRow.className = 'flex gap-1 text-[11px]'; panel.appendChild(presetRow)
const colorRow = document.createElement('div'); colorRow.className = 'flex gap-2 text-[11px] text-slate-300'; panel.appendChild(colorRow)
const lookInputs: (() => void)[] = []
function colorInput(label: string, k: 'deep' | 'shallow') {
  const l = document.createElement('label'); l.className = 'flex flex-1 items-center justify-between'
  l.innerHTML = `${label} <input type="color" class="h-6 w-10 bg-transparent">`
  const inp = l.querySelector('input')!; inp.value = look[k]; inp.oninput = () => { look[k] = inp.value; applyLook() }
  lookInputs.push(() => { inp.value = look[k] }); colorRow.appendChild(l)
}
colorInput('깊은 물', 'deep'); colorInput('얕은 물', 'shallow')
function lookSlider(label: string, min: number, max: number, step: number, k: 'turbidity' | 'clarity' | 'depth', unit = '') {
  slider(label, min, max, step, () => look[k], (v) => { look[k] = v; applyLook() }, unit)
  const el = panel.lastElementChild!, inp = el.querySelector('input')!, out = el.querySelector('span:last-child')!
  lookInputs.push(() => { inp.value = String(look[k]); out.textContent = look[k].toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0) + unit })
}
lookSlider('탁도 Turbidity', 0, 1, 0.01, 'turbidity')
lookSlider('투명 거리 Clarity', 2, 60, 1, 'clarity', ' m')
lookSlider('해저 깊이 Seabed depth', 3, 40, 0.5, 'depth', ' m')
for (const [name, v] of Object.entries(WATER_PRESETS)) {
  const b = document.createElement('button'); b.className = 'flex-1 rounded bg-white/10 px-1 py-1 hover:bg-white/20'; b.textContent = name
  b.onclick = () => { Object.assign(look, v); lookInputs.forEach((f) => f()); applyLook() }; presetRow.appendChild(b)
}
{ const h = document.createElement('div'); h.className = 'border-t border-white/10 pt-2 text-[11px] font-semibold text-slate-200'; h.textContent = '해안 · 거품'; panel.appendChild(h) }
slider('해안 거품 Shore foam', 0, 2, 0.05, () => shore.shoreFoam, (v) => { shore.shoreFoam = v; applyShore() })
slider('해안 파도 세기 Shore waves', 0, 2, 0.05, () => shore.shoreWave, (v) => { shore.shoreWave = v; applyShore() }, ' m')
slider('해안 파장 Shore wavelength', 6, 40, 1, () => shore.shoreLen, (v) => { shore.shoreLen = v; applyShore() }, ' m')
{ const l = document.createElement('label'); l.className = 'flex items-center justify-between text-[11px] text-slate-300'
  l.innerHTML = '거품 색 <input type="color" class="h-6 w-10 bg-transparent">'; const inp = l.querySelector('input')!
  inp.value = shore.foamColor; inp.oninput = () => { shore.foamColor = inp.value; applyShore() }; panel.appendChild(l) }
slider('거품 밝기 Foam brightness', 0.3, 2, 0.05, () => shore.foamBright, (v) => { shore.foamBright = v; applyShore() })
{ const h = document.createElement('div'); h.className = 'border-t border-white/10 pt-2 text-[11px] font-semibold text-slate-200'; h.textContent = '외해 파도 · 거품'; panel.appendChild(h) }
slider('파도 뾰족함 Crest sharpness', 0, 1, 0.05, () => shore.sharp, (v) => { shore.sharp = v; applyShore() })
slider('물살 거품 양 Collision foam', 0, 2, 0.05, () => shore.collFoam, (v) => { shore.collFoam = v; applyShore() })
slider('거품 지속 시간 Foam persistence', 0.3, 4, 0.1, () => shore.persist, (v) => { shore.persist = v; applyShore() }, 'x')
slider('픽셀 비율 Pixel ratio', 0.5, 2, 0.25, () => dpr, (v) => { dpr = v; engine.setHardwareScalingLevel(1 / v) })
const row = (html: string) => { const d = document.createElement('div'); d.className = 'flex gap-1 text-xs'; d.innerHTML = html; panel.appendChild(d); return d }
const qrow = row((['low', 'medium', 'high'] as Quality[]).map((k) => `<button data-q="${k}" class="flex-1 rounded px-2 py-1">${k}</button>`).join(''))
const paintQ = () => qrow.querySelectorAll('button').forEach((b) => { b.className = `flex-1 rounded px-2 py-1 ${b.dataset.q === quality ? 'bg-sky-500' : 'bg-white/10 hover:bg-white/20'}` })
qrow.querySelectorAll('button').forEach((b) => (b.onclick = () => { quality = b.dataset.q as Quality; paintQ(); buildOcean() })); paintQ()
const crow = row(`<button data-c="low" class="flex-1 rounded bg-white/10 px-2 py-1 hover:bg-white/20">수면 시점</button><button data-c="high" class="flex-1 rounded bg-white/10 px-2 py-1 hover:bg-white/20">상공 시점</button>`)
crow.querySelectorAll('button').forEach((b) => (b.onclick = () => goCam(b.dataset.c as keyof typeof CAMS)))
;(window as any).__cam = goCam
