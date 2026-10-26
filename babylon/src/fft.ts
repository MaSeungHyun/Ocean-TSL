// Babylon.js EffectRenderer 기반 GPU FFT 바다 (Tessendorf, 3 캐스케이드)
import { BaseTexture, Constants, EffectRenderer, EffectWrapper, RawTexture, type AbstractEngine, type Effect, type RenderTargetWrapper, type Scene } from '@babylonjs/core'
import { buildSpectra, CASCADE_L, type OceanParams } from './spectrum'
import { derivFS, dispFS, evolveFS, fftFS } from './glsl'

type RT = { w: RenderTargetWrapper; t: BaseTexture }
export class FFTOcean {
  hs = 1; lambda = 1
  private er: EffectRenderer
  private h0: RawTexture[] = []
  private A: RT[] = []; private B: RT[] = []; private ping: RT
  disp: RT[][] = []; deriv: RT[] = []
  private frame = 0
  private evo: EffectWrapper; private fft: EffectWrapper; private dsp: EffectWrapper; private der: EffectWrapper
  constructor(private engine: AbstractEngine, private scene: Scene, public N: number, aniso: number) {
    this.er = new EffectRenderer(engine)
    const W = (name: string, fs: string, u: string[], s: string[]) => new EffectWrapper({ engine, name, fragmentShader: fs, uniformNames: u, samplerNames: s, useShaderStore: false })
    this.evo = W('evolve', evolveFS, ['uN', 'uL', 'uTime', 'uWhich'], ['uH0'])
    this.fft = W('fft', fftFS, ['uN', 'uSub', 'uHoriz'], ['uSrc'])
    this.dsp = W('disp', dispFS, ['uN', 'uLambda', 'uDt', 'uFoamDecay', 'uFoamThr'], ['uA', 'uB', 'uPrev'])
    this.der = W('deriv', derivFS, ['uN', 'uLambda'], ['uA', 'uB'])
    const raw = () => this.rt(Constants.TEXTURETYPE_FLOAT, Constants.TEXTURE_NEAREST_SAMPLINGMODE, false, 1)
    const out = () => this.rt(Constants.TEXTURETYPE_HALF_FLOAT, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE, true, aniso)
    for (let c = 0; c < 3; c++) {
      this.h0.push(new RawTexture(new Float32Array(N * N * 4), N, N, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT))
      this.A.push(raw()); this.B.push(raw()); this.disp.push([out(), out()]); this.deriv.push(out())
    }
    this.ping = raw()
  }
  private rt(type: number, samplingMode: number, mips: boolean, aniso: number): RT {
    const w = this.engine.createRenderTargetTexture(this.N, { type, samplingMode, generateMipMaps: mips, generateDepthBuffer: false, generateStencilBuffer: false, format: Constants.TEXTUREFORMAT_RGBA })
    const t = new BaseTexture(this.scene); t._texture = w.texture
    t.wrapU = t.wrapV = mips ? Constants.TEXTURE_WRAP_ADDRESSMODE : Constants.TEXTURE_CLAMP_ADDRESSMODE
    t.anisotropicFilteringLevel = aniso
    return { w, t }
  }
  setParams(p: OceanParams) {
    const s = buildSpectra(this.N, p); this.hs = s.hs; this.lambda = p.choppy * 1.25
    s.data.forEach((d, c) => this.h0[c].update(d))
  }
  private run(w: EffectWrapper, rt: RT, set: (e: Effect) => void) {
    w.onApplyObservable.clear(); w.onApplyObservable.add(() => { w.effect.setFloat('uN', this.N); set(w.effect) })
    this.er.render(w, rt.w)
  }
  ready() { return [this.evo, this.fft, this.dsp, this.der].every((w) => w.effect.isReady()) }
  private ifft(tgt: RT) {
    let src = tgt, dst = this.ping
    for (const h of [1, 0]) for (let sub = 2; sub <= this.N; sub *= 2) {
      const s = src
      this.run(this.fft, dst, (e) => { e.setTexture('uSrc', s.t); e.setFloat('uSub', sub); e.setFloat('uHoriz', h) });
      [src, dst] = [dst, src]
    }
  }
  /** 반환값: 이번 프레임에 쓴 변위 텍스처 인덱스 (거품 핑퐁) */
  update(time: number, dt: number) {
    if (!this.ready()) return -1
    const cur = this.frame & 1; this.frame++
    for (let c = 0; c < 3; c++) {
      for (const which of [0, 1]) this.run(this.evo, which ? this.B[c] : this.A[c], (e) => {
        e.setTexture('uH0', this.h0[c]); e.setFloat('uL', CASCADE_L[c]); e.setFloat('uTime', time); e.setFloat('uWhich', which) })
      this.ifft(this.A[c]); this.ifft(this.B[c])
      this.run(this.dsp, this.disp[c][cur], (e) => {
        e.setTexture('uA', this.A[c].t); e.setTexture('uB', this.B[c].t); e.setTexture('uPrev', this.disp[c][1 - cur].t)
        e.setFloat('uLambda', this.lambda); e.setFloat('uDt', dt); e.setFloat('uFoamDecay', 0.55); e.setFloat('uFoamThr', 0.45) })
      this.engine.generateMipmaps(this.disp[c][cur].w.texture!)
      this.run(this.der, this.deriv[c], (e) => { e.setTexture('uA', this.A[c].t); e.setTexture('uB', this.B[c].t); e.setFloat('uLambda', this.lambda) })
      this.engine.generateMipmaps(this.deriv[c].w.texture!)
    }
    return cur
  }
  dispose() { this.er.dispose(); [...this.h0].forEach((t) => t.dispose()); [...this.A, ...this.B, this.ping, ...this.disp.flat(), ...this.deriv].forEach((r) => r.w.dispose()) }
}
