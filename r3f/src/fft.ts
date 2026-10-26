// three.js WebGLRenderer 기반 GPU FFT 바다 (Tessendorf, 3 캐스케이드)
import * as THREE from 'three'
import { buildSpectra, CASCADE_L, type OceanParams } from './spectrum'
import { derivFS, dispFS, evolveFS, fftFS } from './glsl'

const quadVS = `void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`
const tri = new THREE.BufferGeometry()
tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))

function pass(fs: string, uniforms: Record<string, THREE.IUniform>) {
  const m = new THREE.ShaderMaterial({ vertexShader: quadVS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false })
  const mesh = new THREE.Mesh(tri, m); mesh.frustumCulled = false
  const scene = new THREE.Scene(); scene.add(mesh)
  return { m, scene }
}
const rawRT = (N: number) => new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, format: THREE.RGBAFormat,
  minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false })
const outRT = (N: number, aniso: number) => {
  const rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true, anisotropy: aniso })
  return rt
}

export class FFTOcean {
  N: number; hs = 1
  private cam = new THREE.Camera()
  private h0: THREE.DataTexture[] = []
  private ping: THREE.WebGLRenderTarget[] = []
  private A: THREE.WebGLRenderTarget[] = []; private B: THREE.WebGLRenderTarget[] = []
  disp: THREE.WebGLRenderTarget[][] = []; deriv: THREE.WebGLRenderTarget[] = []
  private frame = 0
  private evo = pass(evolveFS, { uH0: { value: null }, uN: { value: 0 }, uL: { value: 1 }, uTime: { value: 0 }, uWhich: { value: 0 } })
  private fft = pass(fftFS, { uSrc: { value: null }, uN: { value: 0 }, uSub: { value: 2 }, uHoriz: { value: 1 } })
  private dsp = pass(dispFS, { uA: { value: null }, uB: { value: null }, uPrev: { value: null }, uN: { value: 0 }, uLambda: { value: 1 }, uDt: { value: 0 }, uFoamDecay: { value: 0.55 }, uFoamThr: { value: 0.45 } })
  private der = pass(derivFS, { uA: { value: null }, uB: { value: null }, uN: { value: 0 }, uLambda: { value: 1 } })
  constructor(N: number, aniso: number) {
    this.N = N
    for (let c = 0; c < 3; c++) {
      const t = new THREE.DataTexture(new Float32Array(N * N * 4), N, N, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true
      this.h0.push(t); this.A.push(rawRT(N)); this.B.push(rawRT(N))
      this.disp.push([outRT(N, aniso), outRT(N, aniso)]); this.deriv.push(outRT(N, aniso))
    }
    this.ping = [rawRT(N)]
    for (const p of [this.evo, this.fft, this.dsp, this.der]) p.m.uniforms.uN.value = N
  }
  setParams(p: OceanParams) {
    const s = buildSpectra(this.N, p); this.hs = s.hs
    s.data.forEach((d, c) => { (this.h0[c].image.data as Float32Array).set(d); this.h0[c].needsUpdate = true })
    this.dsp.m.uniforms.uLambda.value = this.der.m.uniforms.uLambda.value = p.choppy * 1.25
  }
  private run(r: THREE.WebGLRenderer, p: { scene: THREE.Scene }, rt: THREE.WebGLRenderTarget) { r.setRenderTarget(rt); r.render(p.scene, this.cam) }
  // 2D 역 FFT (가로 log2N 단계 → 세로 log2N 단계), 결과는 tgt에 남는다
  private ifft(r: THREE.WebGLRenderer, tgt: THREE.WebGLRenderTarget) {
    let src = tgt, dst = this.ping[0]
    const u = this.fft.m.uniforms
    for (const h of [1, 0]) for (let sub = 2; sub <= this.N; sub *= 2) {
      u.uSrc.value = src.texture; u.uSub.value = sub; u.uHoriz.value = h
      this.run(r, this.fft, dst); [src, dst] = [dst, src]
    }
    // 단계 수(2·log2N)가 짝수이므로 결과는 항상 tgt로 돌아온다
  }
  update(r: THREE.WebGLRenderer, time: number, dt: number) {
    const prevRT = r.getRenderTarget(), ac = r.autoClear; r.autoClear = false
    const cur = this.frame & 1; this.frame++
    for (let c = 0; c < 3; c++) {
      const e = this.evo.m.uniforms
      e.uH0.value = this.h0[c]; e.uL.value = CASCADE_L[c]; e.uTime.value = time
      e.uWhich.value = 0; this.run(r, this.evo, this.A[c])
      e.uWhich.value = 1; this.run(r, this.evo, this.B[c])
      this.ifft(r, this.A[c]); this.ifft(r, this.B[c])
      const d = this.dsp.m.uniforms
      d.uA.value = this.A[c].texture; d.uB.value = this.B[c].texture; d.uPrev.value = this.disp[c][1 - cur].texture; d.uDt.value = dt
      this.run(r, this.dsp, this.disp[c][cur])
      const g = this.der.m.uniforms; g.uA.value = this.A[c].texture; g.uB.value = this.B[c].texture
      this.run(r, this.der, this.deriv[c])
    }
    r.setRenderTarget(prevRT); r.autoClear = ac
    return cur
  }
  dispose() { [...this.h0, ...this.A, ...this.B, ...this.ping, ...this.disp.flat(), ...this.deriv].forEach((t) => t.dispose()) }
}
