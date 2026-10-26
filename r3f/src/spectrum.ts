// Tessendorf 초기 스펙트럼 h0(k) (CPU에서 파라미터 변경 시에만 계산)
// JONSWAP + 주파수 의존 cos^2s(θ/2) 방향 분산, 3개 캐스케이드 대역 분할
export interface OceanParams { wind: number; peak: number; choppy: number; windDir: number; hour: number; clouds: number }
export const CASCADE_L = [733.1, 61.7, 7.37]          // 서로 나누어 떨어지지 않는 패치 크기 (m), 가장 큰 타일은 시야 대비 충분히 크게
export const CASCADE_ROT = [0, 0.613, -1.137]        // 캐스케이드별 회전 (rad) → 반복 패턴 깨기
export const CASCADE_OFF = [[0, 0], [0.37, 0.71], [0.13, 0.53]]
const G = 9.81

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

export function jonswapParams(p: OceanParams) {
  const U = Math.max(0.5, p.wind)
  const wp = Math.sqrt((2 * Math.PI * G) / p.peak)              // 피크 파장 → 피크 각주파수
  const F = (G * G) / (U * Math.pow(wp / 22, 3))                 // 대응하는 취송거리 (m)
  const alpha = 0.076 * Math.pow((U * U) / (F * G), 0.22)
  return { wp, alpha, F }
}

/** 반환: 캐스케이드별 RGBA float 텍스처 데이터 (h0(k).re, h0(k).im, conj(h0(-k)).re, conj(h0(-k)).im) 및 유의파고 */
export function buildSpectra(N: number, p: OceanParams) {
  const { wp, alpha } = jonswapParams(p)
  const gamma = 3.3
  const kc: number[] = []
  for (let i = 0; i < CASCADE_L.length; i++) kc.push(i + 1 < CASCADE_L.length ? (2 * Math.PI / CASCADE_L[i + 1]) * 6 : Infinity)
  let variance = 0
  const out: Float32Array[] = []
  for (let c = 0; c < CASCADE_L.length; c++) {
    const L = CASCADE_L[c], dk = (2 * Math.PI) / L
    const kMin = c === 0 ? 0 : kc[c - 1], kMax = kc[c]
    const r = rng(9137 + c * 7919)
    const h0 = new Float32Array(N * N * 2)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const nx = x < N / 2 ? x : x - N, ny = y < N / 2 ? y : y - N
      const kx = nx * dk, kz = ny * dk, k = Math.hypot(kx, kz)
      // 가우시안 난수는 대역 밖에서도 소비해 시드 패턴을 파라미터와 무관하게 유지
      const u1 = Math.max(r(), 1e-9), u2 = r(), u3 = Math.max(r(), 1e-9), u4 = r()
      if (k < Math.max(kMin, 1e-6) || k >= kMax) continue
      const w = Math.sqrt(G * k)
      const sig = w <= wp ? 0.07 : 0.09
      const rr = Math.exp(-((w - wp) ** 2) / (2 * sig * sig * wp * wp))
      let S = (alpha * G * G) / Math.pow(w, 5) * Math.exp(-1.25 * Math.pow(wp / w, 4)) * Math.pow(gamma, rr)
      const s = w > wp ? 9 * Math.pow(w / wp, -2.5) + 1 : 9 * Math.pow(w / wp, 5) + 1
      const th = Math.atan2(kz, kx) - p.windDir
      const D = (Math.sqrt(s + 0.25) / (2 * Math.sqrt(Math.PI))) * Math.pow(Math.abs(Math.cos(th / 2)), 2 * s)
      S *= D * (G / (2 * w)) / k                                  // S(ω,θ) → S(kx,kz)
      S *= Math.exp(-k * k * 0.012 * 0.012)                      // 모세관파 감쇠
      const amp = Math.sqrt((S * dk * dk) / 2)
      const g1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      const g2 = Math.sqrt(-2 * Math.log(u3)) * Math.cos(2 * Math.PI * u4)
      const i = (y * N + x) * 2
      h0[i] = (g1 / Math.SQRT2) * amp; h0[i + 1] = (g2 / Math.SQRT2) * amp
      variance += 2 * amp * amp
    }
    const tex = new Float32Array(N * N * 4)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = (y * N + x), j = (((N - y) % N) * N + ((N - x) % N))
      tex[i * 4] = h0[i * 2]; tex[i * 4 + 1] = h0[i * 2 + 1]
      tex[i * 4 + 2] = h0[j * 2]; tex[i * 4 + 3] = -h0[j * 2 + 1]
    }
    out.push(tex)
  }
  return { data: out, hs: 4 * Math.sqrt(variance) }
}

export interface SkyState { sun: [number, number, number]; sunColor: [number, number, number]; zenith: [number, number, number]; horizon: [number, number, number]; sunI: number }
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const mix3 = (a: number[], b: number[], t: number) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)] as [number, number, number]
export function skyState(hour: number, clouds: number): SkyState {
  const elev = Math.sin(((hour - 6) / 12) * Math.PI) * (68 * Math.PI / 180)
  const az = Math.PI * 1.15 - ((hour - 6) / 12) * Math.PI * 0.6
  const sun: [number, number, number] = [Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az)]
  const day = Math.min(1, Math.max(0, Math.sin(elev) / 0.35))
  const sunColor = mix3([1.0, 0.42, 0.16], [1.0, 0.93, 0.83], day)
  let zenith = mix3([0.05, 0.08, 0.2], [0.09, 0.26, 0.62], day)
  let horizon = mix3([0.95, 0.5, 0.3], [0.5, 0.68, 0.9], day)
  const grey = [0.55, 0.58, 0.62].map((v) => v * (0.35 + 0.65 * day))
  zenith = mix3(zenith, grey, clouds * 0.45); horizon = mix3(horizon, grey, clouds * 0.3)
  const sunI = (0.25 + 2.6 * day) * (1 - clouds * 0.55) * Math.min(1, Math.max(0.05, (elev + 0.05) * 8))
  return { sun, sunColor, zenith, horizon, sunI }
}

// 물빛/탁도 (색은 sRGB hex, 셰이더에 넘길 때 선형 변환)
export interface WaterLook { deep: string; shallow: string; turbidity: number; clarity: number; depth: number }
export const WATER_PRESETS: Record<string, WaterLook> = {
  '열대 맑은 물': { deep: '#06496b', shallow: '#7fe8dc', turbidity: 0.05, clarity: 40, depth: 9 },
  '먼바다': { deep: '#031a3a', shallow: '#3f9fbf', turbidity: 0.12, clarity: 25, depth: 30 },
  '탁한 연안': { deep: '#23402f', shallow: '#9aa86a', turbidity: 0.75, clarity: 6, depth: 12 },
}

// ---------- 섬 지형 + 해안 거리장 베이크 ----------
export const ISLAND_C = [-260, -720]
/** 섬 로컬 좌표의 지형 높이 (월드 y, 메시는 y=-3에 배치) */
export function islandHeight(x: number, z: number) {
  const r = Math.hypot(x, z) / 150
  const n = Math.sin(x * 0.05) * Math.cos(z * 0.06) * 3 + Math.sin(x * 0.13 + z * 0.09) * 1.5
  return 42 * Math.exp(-r * r * 2.2) + n * Math.exp(-r * r) - 4 * r * r + 1.5 - 3
}
function chamfer(src: Uint8Array, N: number) {
  const d = new Float32Array(N * N); const INF = 1e9
  for (let i = 0; i < N * N; i++) d[i] = src[i] ? 0 : INF
  const D = Math.SQRT2
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x; let v = d[i]
    if (x > 0) v = Math.min(v, d[i - 1] + 1); if (y > 0) { v = Math.min(v, d[i - N] + 1); if (x > 0) v = Math.min(v, d[i - N - 1] + D); if (x < N - 1) v = Math.min(v, d[i - N + 1] + D) } d[i] = v }
  for (let y = N - 1; y >= 0; y--) for (let x = N - 1; x >= 0; x--) { const i = y * N + x; let v = d[i]
    if (x < N - 1) v = Math.min(v, d[i + 1] + 1); if (y < N - 1) { v = Math.min(v, d[i + N] + 1); if (x < N - 1) v = Math.min(v, d[i + N + 1] + D); if (x > 0) v = Math.min(v, d[i + N - 1] + D) } d[i] = v }
  return d
}
/** RGBA float: 지형 높이, 물가 부호 거리(m, 물 쪽 +), 해안 방향(x,z). rect = [minX, minZ, size] */
export function bakeShore(N = 512, size = 1000) {
  const minX = ISLAND_C[0] - size / 2, minZ = ISLAND_C[1] - size / 2, cell = size / N
  const h = new Float32Array(N * N), land = new Uint8Array(N * N), water = new Uint8Array(N * N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const wx = minX + (x + 0.5) * cell, wz = minZ + (y + 0.5) * cell, i = y * N + x
    h[i] = islandHeight(wx - ISLAND_C[0], wz - ISLAND_C[1]); land[i] = h[i] > 0 ? 1 : 0; water[i] = 1 - land[i]
  }
  const dl = chamfer(land, N), dw = chamfer(water, N)
  const sd = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) sd[i] = (land[i] ? -(dw[i] - 0.5) : dl[i] - 0.5) * cell
  const out = new Float32Array(N * N * 4)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, xm = Math.max(0, x - 2), xp = Math.min(N - 1, x + 2), ym = Math.max(0, y - 2), yp = Math.min(N - 1, y + 2)
    let gx = sd[y * N + xp] - sd[y * N + xm], gz = sd[yp * N + x] - sd[ym * N + x]
    const l = Math.hypot(gx, gz) || 1; gx /= l; gz /= l
    out.set([h[i], sd[i], -gx, -gz], i * 4)
  }
  return { data: out, N, rect: [minX, minZ, size] as [number, number, number] }
}
export interface ShoreLook { shoreFoam: number; shoreWave: number; shoreLen: number; foamColor: string; foamBright: number }
export const SHORE_DEFAULT: ShoreLook = { shoreFoam: 1, shoreWave: 0.6, shoreLen: 16, foamColor: '#f2f7f7', foamBright: 1 }
