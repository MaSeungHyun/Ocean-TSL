// @ts-nocheck -- TSL 노드 체인 타이핑 예외 (oceanTSL.ts 참고)
// WebGPU용 GPU FFT: 스펙트럼 진화 + Stockham 역 FFT는 TSL 컴퓨트(스토리지 버퍼),
// 최종 변위/미분은 밉맵이 필요한 렌더 타깃으로 풀스크린 패스 (WebGL 버전과 같은 텍스처 인터페이스)
import * as THREE from "three";
import { MeshBasicNodeMaterial, QuadMesh } from "three/webgpu";
import {
  Fn, float, int, uint, vec2, vec4, ivec2, uniform, texture, storage, instancedArray, instanceIndex,
  screenCoordinate, step, length, max, sqrt, cos, sin, floor, exp, clamp, smoothstep,
  workgroupArray, workgroupBarrier, workgroupId, localId,
} from "three/tsl";
import { buildSpectra, CASCADE_L, type OceanParams } from "../spectrum";
import type { OceanSim, UpdateMode } from "../fft";

const PI2 = 6.283185307;
const cmul = (a, b) => vec2(a.x.mul(b.x).sub(a.y.mul(b.y)), a.x.mul(b.y).add(a.y.mul(b.x)));
const pack = (a, b) => vec2(a.x.sub(b.y), a.y.add(b.x)); // a + i·b
const outRT = (N: number, aniso: number) =>
  new THREE.RenderTarget(N, N, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true, anisotropy: aniso,
  });

export class FFTOceanGPU implements OceanSim {
  N: number[];
  hs = 1;
  disp: THREE.RenderTarget[][] = [];
  deriv: THREE.RenderTarget[] = [];
  private uTime = uniform(0);
  private uLambda = uniform(1);
  private uFoamDecay = uniform(0.55);
  private uFoamThr = uniform(0.45);
  private cas: any[] = [];
  private cur = [0, 0, 0];
  private lastT = [-1, -1, -1];
  private frame = 0;
  private quad = new QuadMesh();
  constructor(Ns: number[], aniso: number) {
    this.N = Ns.slice(0, 3);
    for (let c = 0; c < 3; c++) {
      const N = this.N[c], NN = N * N, L = CASCADE_L[c];
      const h0 = instancedArray(NN, "vec4");
      const A = [instancedArray(NN, "vec4"), instancedArray(NN, "vec4")];
      const B = [instancedArray(NN, "vec4"), instancedArray(NN, "vec4")];
      const uN = uint(N);
      const evo = Fn(() => {
        const i = instanceIndex;
        const p = vec2(float(i.mod(uN)), float(i.div(uN))).toVar();
        const n = p.sub(step(N * 0.5, p).mul(N));
        const k = n.mul(PI2 / L).toVar();
        const kl = max(length(k), 1e-6).toVar();
        const w = sqrt(kl.mul(9.81));
        const hv = h0.element(i).toVar();
        const e = vec2(cos(w.mul(this.uTime)), sin(w.mul(this.uTime))).toVar();
        const h = cmul(hv.xy, e).add(cmul(hv.zw, vec2(e.x, e.y.negate()))).toVar();
        const ih = vec2(h.y.negate(), h.x).toVar();
        const Dx = ih.mul(k.x).div(kl), Dz = ih.mul(k.y).div(kl), Dyx = ih.mul(k.x);
        const Dyz = ih.mul(k.y), Dxx = h.negate().mul(k.x).mul(k.x).div(kl);
        const Dzz = h.negate().mul(k.y).mul(k.y).div(kl), Dxz = h.negate().mul(k.x).mul(k.y).div(kl);
        A[0].element(i).assign(vec4(pack(Dx, h), pack(Dz, Dyx)));
        B[0].element(i).assign(vec4(pack(Dyz, Dxx), pack(Dzz, Dxz)));
      })().compute(NN);
      // 행/열 하나를 워크그룹 하나가 공유 메모리에서 log2N 단계 전부 처리 (비트반전 로드 → 제자리 버터플라이)
      // → 캐스케이드당 디스패치 2회 (가로 A0→A1, 세로 A1→A0), 전역 메모리 왕복 2log2N회 → 2회
      const stages = [true, false].map((horiz) => {
        const W = N / 2, LOG = Math.log2(N);
        const src = horiz ? 0 : 1, dst = 1 - src;
        const sA = workgroupArray("vec4", N), sB = workgroupArray("vec4", N);
        return Fn(() => {
          const t = localId.x, line = workgroupId.x;
          const gi = (n) => (horiz ? line.mul(uN).add(n) : n.mul(uN).add(line));
          const rev = (n) => {
            let r = uint(0);
            for (let b = 0; b < LOG; b++) r = r.bitOr(n.shiftRight(uint(b)).bitAnd(uint(1)).shiftLeft(uint(LOG - 1 - b)));
            return r;
          };
          for (const n of [t, t.add(uint(W))]) {
            const g = gi(rev(n)).toVar();
            sA.element(n).assign(A[src].element(g));
            sB.element(n).assign(B[src].element(g));
          }
          workgroupBarrier();
          for (let m = 2; m <= N; m *= 2) {
            const half = m / 2;
            const j = t.mod(uint(half)).toVar();
            const i0 = t.div(uint(half)).mul(uint(m)).add(j).toVar(), i1 = i0.add(uint(half)).toVar();
            const ang = float(j).mul(PI2 / m);
            const w = vec2(cos(ang), sin(ang)).toVar();
            for (const S of [sA, sB]) {
              const a = S.element(i0).toVar(), b = S.element(i1).toVar();
              const wb = vec4(cmul(w, b.xy), cmul(w, b.zw)).toVar();
              S.element(i0).assign(a.add(wb));
              S.element(i1).assign(a.sub(wb));
            }
            workgroupBarrier();
          }
          for (const n of [t, t.add(uint(W))]) {
            const g = gi(n).toVar();
            A[dst].element(g).assign(sA.element(n));
            B[dst].element(g).assign(sB.element(n));
          }
        })().compute(N * W, [W]);
      });
      const disp = [outRT(N, aniso), outRT(N, aniso)], deriv = outRT(N, aniso);
      const rA = storage(A[0].value, "vec4", NN).toReadOnly(), rB = storage(B[0].value, "vec4", NN).toReadOnly();
      const prev = texture(disp[1].texture);
      const uDt = uniform(0);
      const texel = () => {
        const pc = ivec2(floor(screenCoordinate.xy)).toVar();
        return { pc, i: pc.y.mul(int(N)).add(pc.x).toVar() };
      };
      const dispMat = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
      dispMat.toneMapped = false;
      dispMat.fragmentNode = Fn(() => {
        const { pc, i } = texel();
        const a = rA.element(i).toVar(), b = rB.element(i).toVar();
        const lam = this.uLambda;
        const J = float(1).add(lam.mul(b.y)).mul(float(1).add(lam.mul(b.z))).sub(lam.mul(lam).mul(b.w).mul(b.w));
        const inj = smoothstep(this.uFoamThr, this.uFoamThr.sub(0.45), J);
        const foam = clamp(max(prev.load(pc).w.mul(exp(uDt.negate().mul(this.uFoamDecay))), inj), 0.0, 1.0);
        return vec4(lam.mul(a.x), a.y, lam.mul(a.z), foam);
      })();
      const derMat = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
      derMat.toneMapped = false;
      derMat.fragmentNode = Fn(() => {
        const { i } = texel();
        const a = rA.element(i).toVar(), b = rB.element(i).toVar();
        return vec4(a.w, b.x, this.uLambda.mul(b.y), this.uLambda.mul(b.z));
      })();
      this.disp.push(disp);
      this.deriv.push(deriv);
      this.cas.push({ h0, evo, stages, dispMat, derMat, prev, uDt });
    }
  }
  setFoam(collFoam: number, persist: number) {
    this.uFoamThr.value = 0.45 + 0.25 * collFoam;
    this.uFoamDecay.value = 0.55 / Math.max(persist, 0.1);
  }
  setParams(p: OceanParams) {
    const byN = new Map<number, ReturnType<typeof buildSpectra>>();
    for (const N of this.N) if (!byN.has(N)) byN.set(N, buildSpectra(N, p));
    this.hs = byN.get(Math.max(...this.N))!.hs;
    this.N.forEach((N, c) => {
      const attr = this.cas[c].h0.value;
      attr.array.set(byN.get(N)!.data[c]);
      attr.needsUpdate = true;
    });
    this.uLambda.value = p.choppy * 1.25;
  }
  update(r: any, time: number, _dt: number, mode: UpdateMode = "every", nth = 2) {
    const prevRT = r.getRenderTarget();
    const f = this.frame++;
    this.uTime.value = time;
    for (let c = 0; c < 3; c++) {
      const first = this.lastT[c] < 0;
      const due = first || mode === "every" || (mode === "alt" ? c === 2 || (f & 1) === c : f % Math.max(1, nth) === 0);
      if (!due) continue;
      const k = this.cas[c];
      k.uDt.value = first ? 0 : Math.min(time - this.lastT[c], 0.25);
      this.lastT[c] = time;
      const cur = (this.cur[c] = 1 - this.cur[c]);
      r.compute(k.evo);
      r.compute(k.stages);
      k.prev.value = this.disp[c][1 - cur].texture;
      this.quad.material = k.dispMat;
      r.setRenderTarget(this.disp[c][cur]);
      this.quad.render(r);
      this.quad.material = k.derMat;
      r.setRenderTarget(this.deriv[c]);
      this.quad.render(r);
    }
    r.setRenderTarget(prevRT);
    return this.cur;
  }
  dispose() {
    [...this.disp.flat(), ...this.deriv].forEach((t) => t.dispose());
    this.cas.forEach((k) => { k.dispMat.dispose(); k.derMat.dispose(); });
  }
}