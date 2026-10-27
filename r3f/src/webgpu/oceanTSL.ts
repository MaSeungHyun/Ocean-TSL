// @ts-nocheck -- TSL 노드 체인은 @types/three의 제네릭 타이핑이 지나치게 엄격해 이 셰이더 라이브러리 파일만 타입 검사 제외
// glsl.ts(WebGL2 셰이더)를 TSL 노드로 옮긴 버전. 유니폼은 ShaderMaterial과 같은 이름/`.value` 인터페이스로 노출
import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  Discard,
  select,
  float,
  int,
  vec2,
  vec3,
  vec4,
  ivec2,
  uniform,
  uniformArray,
  texture,
  varyingProperty,
  attribute,
  positionLocal,
  positionGeometry,
  positionWorld,
  normalWorld,
  screenCoordinate,
  mix,
  smoothstep,
  step,
  clamp,
  pow,
  exp,
  log,
  log2,
  sqrt,
  length,
  normalize,
  dot,
  cross,
  reflect,
  refract,
  fract,
  floor,
  sin,
  cos,
  acos,
  abs,
  max,
  min,
  fwidth,
  dFdx,
  dFdy,
} from "three/tsl";
import { CASCADE_L, CASCADE_OFF, CASCADE_ROT } from "../spectrum";
import { MAX_PTS, SHORE, STRIP, probeRT, shoreTex } from "../scene/resources";

const PI = 3.14159;
const [L0, L1, L2] = CASCADE_L;
const [R0, R1, R2] = CASCADE_ROT;
const O0 = vec2(...CASCADE_OFF[0]),
  O1 = vec2(...CASCADE_OFF[1]),
  O2 = vec2(...CASCADE_OFF[2]);
const RECT = SHORE.rect;
const SHN = SHORE.N;
const shoreNode = texture(shoreTex);
const modp = (x, y) => x.sub(floor(x.div(y)).mul(y)); // GLSL mod (음수에서도 양수)

// ---------- 유니폼을 쓰지 않는 공용 함수 (WGSL 함수로 1회 생성) ----------
const hash3 = Fn(([p0]) => {
  const p = fract(p0.mul(0.3183099).add(0.1)).mul(17.0).toVar();
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)));
}).setLayout({
  name: "hash3",
  type: "float",
  inputs: [{ name: "p", type: "vec3" }],
});

export const vnoise = Fn(([x]) => {
  const i = floor(x).toVar();
  const f0 = fract(x).toVar();
  const f = f0
    .mul(f0)
    .mul(f0)
    .mul(f0.mul(f0.mul(6.0).sub(15.0)).add(10.0))
    .toVar();
  const h = (a, b, c) => hash3(i.add(vec3(a, b, c)));
  return mix(
    mix(
      mix(h(0, 0, 0), h(1, 0, 0), f.x),
      mix(h(0, 1, 0), h(1, 1, 0), f.x),
      f.y,
    ),
    mix(
      mix(h(0, 0, 1), h(1, 0, 1), f.x),
      mix(h(0, 1, 1), h(1, 1, 1), f.x),
      f.y,
    ),
    f.z,
  );
}).setLayout({
  name: "vnoise",
  type: "float",
  inputs: [{ name: "x", type: "vec3" }],
});

const fbmN = (o) =>
  Fn(([p0]) => {
    const p = p0.toVar(),
      a = float(0.5).toVar(),
      s = float(0).toVar();
    Loop(o, () => {
      s.addAssign(a.mul(vnoise(p)));
      p.assign(
        vec3(
          p.x.mul(0.8).sub(p.y.mul(0.6)),
          p.x.mul(0.6).add(p.y.mul(0.8)),
          p.z,
        )
          .mul(2.03)
          .add(vec3(1.7, 9.2, 0.0)),
      );
      a.mulAssign(0.5);
    });
    return s;
  }).setLayout({
    name: `fbm${o}`,
    type: "float",
    inputs: [{ name: "p", type: "vec3" }],
  });
const FBM = { 2: fbmN(2), 3: fbmN(3), 5: fbmN(5) };
const fbm = (p, o) => FBM[o](p);

const rotS = Fn(([v, a]) => {
  const c = cos(a),
    s = sin(a);
  return vec2(c.mul(v.x).sub(s.mul(v.y)), s.mul(v.x).add(c.mul(v.y)));
}).setLayout({
  name: "rotS",
  type: "vec2",
  inputs: [
    { name: "v", type: "vec2" },
    { name: "a", type: "float" },
  ],
});

const hash1 = (n) => fract(sin(n.mul(12.9898).add(4.1)).mul(43758.5453));
const hash2 = (p) =>
  fract(
    sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(
      43758.5453,
    ),
  );

// Worley F2-F1: 셀 경계에서 0 → 레이스 모양 거품
const worley = Fn(([p, t]) => {
  const i = floor(p).toVar(),
    f = fract(p).toVar();
  const F1 = float(8).toVar(),
    F2 = float(8).toVar();
  for (let y = -1; y <= 1; y++)
    for (let x = -1; x <= 1; x++) {
      const o = vec2(x, y);
      const r = float(0.5).add(
        sin(t.add(hash2(i.add(o)).mul(6.2831))).mul(0.4),
      );
      const dv = o.add(r).sub(f);
      const dd = dot(dv, dv).toVar();
      If(dd.lessThan(F1), () => {
        F2.assign(F1);
        F1.assign(dd);
      }).ElseIf(dd.lessThan(F2), () => {
        F2.assign(dd);
      });
    }
  return sqrt(F2).sub(sqrt(F1));
}).setLayout({
  name: "worley",
  type: "float",
  inputs: [
    { name: "p", type: "vec2" },
    { name: "t", type: "float" },
  ],
});

const caustTile = Fn(([uv, t]) => {
  const p = modp(uv.mul(6.28318), 6.28318).sub(250.0).toVar();
  const i = p.toVar(),
    c = float(1).toVar();
  for (let n = 0; n < 4; n++) {
    const tt = t.mul(1.0 - 3.5 / (n + 1)).toVar();
    i.assign(
      p.add(
        vec2(
          cos(tt.sub(i.x)).add(sin(tt.add(i.y))),
          sin(tt.sub(i.y)).add(cos(tt.add(i.x))),
        ),
      ),
    );
    c.addAssign(
      float(1).div(
        length(
          vec2(
            p.x.div(sin(i.x.add(tt)).div(0.005)),
            p.y.div(cos(i.y.add(tt)).div(0.005)),
          ),
        ),
      ),
    );
  }
  c.divAssign(4.0);
  c.assign(float(1.17).sub(pow(c, 1.4)));
  return pow(abs(c), 8.0);
}).setLayout({
  name: "caustTile",
  type: "float",
  inputs: [
    { name: "uv", type: "vec2" },
    { name: "t", type: "float" },
  ],
});

// 해안 거리장: 수동 바이리니어 (textureLoad, float 텍스처 필터 불필요)
const shoreInfo = Fn(([xz]) => {
  const res = vec4(-1000, 1000, 0, 0).toVar();
  const uv = xz.sub(vec2(RECT[0], RECT[1])).div(RECT[2]).toVar();
  If(
    uv.x
      .greaterThanEqual(0)
      .and(uv.y.greaterThanEqual(0))
      .and(uv.x.lessThanEqual(1))
      .and(uv.y.lessThanEqual(1)),
    () => {
      const st = uv.mul(SHN).sub(0.5);
      const i0 = floor(st).toVar();
      const fr0 = st.sub(i0);
      const fr = fr0.mul(fr0).mul(fr0.mul(-2.0).add(3.0)).toVar();
      const ld = (dx, dy) =>
        shoreNode.load(
          clamp(
            ivec2(i0.add(vec2(dx, dy))),
            ivec2(0, 0),
            ivec2(SHN - 1, SHN - 1),
          ),
        );
      res.assign(
        mix(mix(ld(0, 0), ld(1, 0), fr.x), mix(ld(0, 1), ld(1, 1), fr.x), fr.y),
      );
    },
  );
  return res;
  // setLayout 금지: 레이아웃 함수 안에서는 텍스처 바인딩이 해석되지 않음 (WGSL unresolved nodeUniform)
});

// ---------- 유니폼 세트 ----------
export const skyU = () => ({
  uTime: uniform(0),
  uSun: uniform(new THREE.Vector3()),
  uSunColor: uniform(new THREE.Color()),
  uSunI: uniform(1),
  uZenith: uniform(new THREE.Color()),
  uHorizon: uniform(new THREE.Color()),
  uClouds: uniform(0),
  uCam: uniform(new THREE.Vector3()),
  uUnderG: uniform(0),
  uSplit: uniform(0),
  uWL: texture(probeRT.texture),
  uRes: uniform(new THREE.Vector2(1, 1)),
  uCamF: uniform(new THREE.Vector3()),
  uNear: uniform(0.3),
  uUWCol: uniform(new THREE.Color()),
  uUWDens: uniform(0.09),
  uCamDepth: uniform(0),
});
const shoreU = () => ({
  uShoreA: uniform(0.6),
  uShoreLen: uniform(16),
  uDepth: uniform(10),
});

// ---------- 유니폼 의존 라이브러리 (common + shoreLib + sampling) ----------
function lib(u) {
  const T = u.uTime;
  const sunC = u.uSunColor.mul(u.uSunI);
  const uwExt = () =>
    u.uUWDens.mul(float(0.25).sub(log(clamp(u.uUWCol.mul(1.6), 0.03, 0.97))));
  // 픽셀 단위 수면 분할 (GLSL 전역 uUnder/uMen → 반환값)
  const uwInit = (wp, cam) => {
    const under = float(u.uUnderG).toVar(),
      men = float(0).toVar();
    If(u.uSplit.greaterThan(0.001), () => {
      const d = normalize(wp.sub(cam)).toVar();
      const np = cam.add(d.mul(u.uNear.div(max(dot(d, u.uCamF), 0.05))));
      const px = clamp(
        int(screenCoordinate.x.mul(STRIP).div(u.uRes.x)),
        int(0),
        int(STRIP - 1),
      );
      const h = u.uWL.load(ivec2(px, int(0))).x;
      const e = h
        .sub(np.y)
        .add(sin(screenCoordinate.x.mul(0.045).add(T.mul(3.0))).mul(0.0015))
        .toVar();
      under.assign(mix(u.uUnderG, smoothstep(-0.0015, 0.0015, e), u.uSplit));
      men.assign(
        u.uSplit.mul(float(1).sub(smoothstep(0.0, 0.006, abs(e.sub(0.0015))))),
      );
    });
    return { under, men };
  };
  const meniscus = (c, men) =>
    mix(c, c.mul(0.35).add(u.uUWCol.mul(0.08)), men.mul(0.8));
  const uwMedium = (dir) => {
    const light = sunC
      .mul(max(u.uSun.y, 0.05))
      .mul(0.55)
      .add(u.uZenith.mul(0.4))
      .add(u.uHorizon.mul(0.15))
      .mul(exp(uwExt().negate().mul(max(u.uCamDepth, 0.0)).mul(0.6)));
    const c = u.uUWCol
      .mul(light)
      .mul(mix(0.25, 1.25, smoothstep(-0.9, 0.8, dir.y)))
      .toVar();
    const sd = normalize(
      vec3(u.uSun.x, max(u.uSun.y, 0.1).mul(1.333).add(0.3), u.uSun.z),
    );
    const cs = max(dot(dir, sd), 0.0).toVar();
    const q = dir.xz.div(abs(dir.y).add(0.25)).toVar();
    const rays = vnoise(vec3(q.mul(vec2(3.0, 9.0)), T.mul(0.25))).mul(
      vnoise(vec3(q.mul(vec2(7.0, 2.5)).add(4.0), T.mul(0.35))),
    );
    c.addAssign(
      u.uUWCol
        .mul(sunC)
        .mul(pow(cs, 6.0).mul(0.35).add(pow(cs, 3.0).mul(rays).mul(0.9)))
        .mul(smoothstep(-0.2, 0.5, dir.y)),
    );
    return c;
  };
  const underFog = (col, dist, dir) => {
    const Tr = exp(uwExt().negate().mul(dist)).toVar();
    return col.mul(Tr).add(uwMedium(dir).mul(float(1).sub(Tr)));
  };
  const sky = (d, oct, disk) => {
    const y = max(d.y, 0.0);
    const col = mix(u.uHorizon, u.uZenith, pow(y, 0.5)).toVar();
    col.assign(mix(col, u.uHorizon.mul(0.85), smoothstep(0.0, -0.08, d.y)));
    const s = max(dot(d, u.uSun), 0.0).toVar();
    col.addAssign(sunC.mul(pow(s, 6.0).mul(0.12).add(pow(s, 90.0).mul(0.5))));
    if (disk)
      col.addAssign(
        sunC
          .mul(smoothstep(0.99955, 0.9998, s))
          .mul(float(1).sub(u.uClouds.mul(0.7)))
          .mul(30.0 * disk),
      );
    if (oct > 0) {
      const uv = d.xz
        .div(d.y.add(0.12))
        .mul(0.9)
        .add(vec2(T.mul(0.004), T.mul(0.0015)));
      const n = fbm(vec3(uv.mul(1.6), T.mul(0.003)), oct).toVar();
      const c = smoothstep(
        float(1.05).sub(u.uClouds.mul(0.8)),
        float(1.25).sub(u.uClouds.mul(0.7)),
        n.mul(1.75),
      ).mul(smoothstep(0.0, 0.12, d.y));
      const lit = u.uSunColor
        .mul(u.uSunI.mul(0.35).add(0.25))
        .mul(mix(0.75, 1.15, pow(s, 4.0)));
      col.assign(
        mix(
          col,
          mix(u.uHorizon.mul(0.6), lit, clamp(n.mul(1.4).sub(0.3), 0.0, 1.0)),
          c.mul(0.92),
        ),
      );
    }
    return col;
  };
  return { T, sunC, uwInit, meniscus, uwMedium, underFog, sky };
}

function shoreLib(u) {
  const waterDepth = (h) => clamp(h.negate(), 0.0, u.uDepth);
  const runup = (xz, t) => {
    const k = float(6.28318).div(u.uShoreLen),
      om = sqrt(k.mul(9.81)).mul(0.75);
    const ph0 = t
      .mul(om)
      .add(vnoise(vec3(xz.mul(0.011), t.mul(0.015))).mul(7.0));
    const cyc = ph0.sub(1.5708).div(6.28318).toVar();
    const n = floor(cyc).toVar(),
      s = cyc.sub(n).toVar();
    const vr = float(0.55).add(
      vnoise(vec3(xz.mul(0.025), t.mul(0.01).add(2.0))).mul(0.9),
    );
    const wv = mix(0.45, 1.35, hash1(n)).mul(
      mix(0.7, 1.15, vnoise(vec3(xz.mul(0.06), n.mul(1.7)))),
    );
    const R = u.uShoreA.mul(vr).mul(wv).mul(8.0).add(0.3).toVar();
    const a = 0.32;
    const f = select(
      s.lessThan(a),
      sin(s.div(a).mul(1.5708)),
      pow(
        max(
          cos(
            s
              .sub(a)
              .div(1 - a)
              .mul(1.5708),
          ),
          0.0,
        ),
        1.4,
      ),
    ).toVar();
    const F = R.mul(f).add(
      vnoise(vec3(xz.mul(0.35), t.mul(0.2)))
        .sub(0.5)
        .mul(0.8)
        .mul(f),
    );
    return vec4(s, R, F, a);
  };
  const swash = (xz, si, t) => {
    const res = vec4(0).toVar();
    const d = si.y;
    If(d.lessThanEqual(95.0).and(u.uShoreA.greaterThan(0.0)), () => {
      const k = float(6.28318).div(u.uShoreLen).toVar();
      const ru = runup(xz, t).toVar();
      const s = ru.x,
        R = ru.y,
        F = ru.z;
      const up = float(1)
        .sub(smoothstep(ru.w.sub(0.05), ru.w.add(0.05), s))
        .toVar();
      If(d.lessThan(0.0), () => {
        const x = d.negate().toVar();
        If(x.greaterThan(R.mul(1.6).add(3.0)), () => {
          res.assign(vec4(si.x.sub(0.6), 0, 0, 0));
        }).Else(() => {
          const inside = F.sub(x).toVar();
          const film = select(
            inside.greaterThan(0.0),
            float(0.035).add(
              mix(0.12, 0.3, up).mul(
                sqrt(clamp(inside.div(max(F, 0.5)), 0.0, 1.0)),
              ),
            ),
            float(-0.5).add(min(inside, 0.0).mul(0.05)),
          );
          const lead = smoothstep(-0.2, -1.8, x.sub(F))
            .mul(step(x, F.add(0.05)))
            .mul(mix(0.45, 1.0, up));
          const back = float(1)
            .sub(up)
            .mul(smoothstep(0.0, 1.5, inside))
            .mul(0.55);
          res.assign(vec4(si.x.add(film), -0.08, lead, back));
        });
      }).Else(() => {
        const ph = s.mul(6.28318).add(1.5708).add(d.mul(k)).toVar();
        const env = smoothstep(95.0, 30.0, d);
        const shoal = float(1).add(smoothstep(30.0, 2.0, d).mul(1.6));
        const steep = mix(1.0, 5.0, smoothstep(45.0, 2.0, d)).toVar();
        const c = sin(ph).mul(0.5).add(0.5).toVar();
        const p = pow(max(c, 1e-6), steep);
        const vr = float(0.55)
          .add(vnoise(vec3(xz.mul(0.025), t.mul(0.01).add(2.0))).mul(0.9))
          .toVar();
        const A = u.uShoreA.mul(env).mul(shoal).mul(vr).mul(0.5).toVar();
        const dp = steep
          .mul(pow(max(c, 1e-3), steep.sub(1.0)))
          .mul(0.5)
          .mul(cos(ph))
          .mul(k);
        const b = smoothstep(0.0, 6.0, d).toVar();
        const film0 = select(
          F.greaterThan(0.0),
          float(0.035).add(mix(0.12, 0.3, up)),
          float(0.0),
        );
        const h = A.mul(p)
          .mul(b)
          .add(film0.mul(float(1).sub(b)));
        const lead = smoothstep(0.8, 0.985, c)
          .mul(smoothstep(28.0, 3.0, d))
          .mul(vr)
          .add(float(1).sub(b).mul(up).mul(0.5));
        const behind = fract(ph.sub(1.5708).div(6.28318));
        const linger = exp(behind.mul(-5.0))
          .mul(smoothstep(22.0, 1.0, d))
          .mul(vr);
        res.assign(vec4(h, A.mul(dp).mul(b), lead, linger));
      });
    });
    return res;
  };
  return { waterDepth, runup, swash };
}

function sampling(u, T) {
  const ampMod = (xz) =>
    float(0.3).add(
      clamp(
        vnoise(vec3(xz.mul(0.0011), T.mul(0.003)))
          .mul(0.65)
          .add(vnoise(vec3(xz.mul(0.0037).add(5.3), T.mul(0.006))).mul(0.35)),
        0.0,
        1.0,
      ).mul(1.4),
    );
  const bombW = (xz, L, seed) =>
    smoothstep(0.25, 0.75, vnoise(vec3(xz.div(L * 2.37), seed)));
  const cuv = (xz, L, a, off) => rotS(xz, -a).div(L).add(off);
  const peakMod = (xz) =>
    smoothstep(
      0.32,
      0.72,
      vnoise(vec3(xz.mul(0.0008).add(17.0), T.mul(0.0025)))
        .mul(0.7)
        .add(vnoise(vec3(xz.mul(0.0029).add(3.1), T.mul(0.005))).mul(0.3)),
    );
  return { ampMod, bombW, cuv, peakMod };
}

// ---------- 바다 변위 (정점 + 프로브 공용) ----------
function displacer(u) {
  const S = sampling(u, u.uTime),
    SL = shoreLib(u);
  const casc = (t, xz, L, a, off, lod) => {
    const d = t
      .sample(S.cuv(xz, L, a, off))
      .level(lod)
      .xyz.toVar();
    const h = rotS(d.xz, a);
    return vec3(h.x, d.y, h.y);
  };
  const cascB = (t, xz, L, a, off, spacing, seed, tn) => {
    const lod = max(0.0, log2(spacing.mul(tn).div(L)).add(0.5)).toVar();
    const w = S.bombW(xz, L, seed).toVar();
    const A = casc(t, xz, L, a, off, lod),
      B = casc(t, xz, L, a + 2.17, off.add(vec2(0.41, 0.27)), lod);
    return A.mul(w)
      .add(B.mul(float(1).sub(w)))
      .div(sqrt(w.mul(w).add(float(1).sub(w).mul(float(1).sub(w)))));
  };
  return (local) => {
    const xz = local.xz.add(u.uOffset).toVar();
    const r = length(local.xz).toVar();
    const spacing = max(r.mul(u.uG), 0.05).toVar();
    const hd = max(length(vec3(xz.x, 0.0, xz.y).sub(u.uCam)), 1.0);
    const m = S.ampMod(xz).toVar();
    const si = shoreInfo(xz).toVar();
    const wd = SL.waterDepth(si.x).toVar();
    const att0 = float(0.12).add(smoothstep(0.5, 18.0, wd).mul(0.88)),
      att1 = smoothstep(0.4, 9.0, wd).toVar();
    const lod0 = max(
      0.0,
      log2(spacing.mul(u.uTexN.x).div(L0)).add(0.5),
    ).toVar();
    const w0 = mix(1.0, m, 0.6).mul(att0).toVar(),
      w1 = m.mul(att1).toVar();
    const c01 = casc(u.uDisp0, xz, L0, R0, O0, lod0)
      .mul(w0)
      .add(cascB(u.uDisp1, xz, L1, R1, O1, spacing, 1.3, u.uTexN.y).mul(w1))
      .toVar();
    const lod1 = max(0.0, log2(spacing.mul(u.uTexN.y).div(L1)).add(0.5));
    const j0 = u.uDer0
      .sample(S.cuv(xz, L0, R0, O0))
      .level(lod0)
      .toVar();
    const j1 = u.uDer1
      .sample(S.cuv(xz, L1, R1, O1))
      .level(lod1)
      .toVar();
    const jm = min(j0.z, j0.w).mul(w0).add(min(j1.z, j1.w).mul(w1)).toVar();
    const sh = float(1)
      .add(u.uSharp.mul(1.2).mul(S.peakMod(xz)))
      .toVar();
    If(jm.lessThan(0.0), () => {
      sh.assign(min(sh, max(float(0.95).div(jm.negate()), 0.7)));
    });
    const d = vec3(c01.x.mul(sh), c01.y, c01.z.mul(sh))
      .add(
        cascB(u.uDisp2, xz, L2, R2, O2, spacing, 4.7, u.uTexN.z)
          .mul(m)
          .mul(att1)
          .mul(float(1).sub(smoothstep(150.0, 600.0, hd))),
      )
      .toVar();
    d.mulAssign(
      float(1)
        .sub(smoothstep(9000.0, 24000.0, r))
        .mul(smoothstep(-0.5, 3.0, si.y)),
    );
    const sy = d.y.add(SL.swash(xz, si, u.uTime).x);
    return vec3(xz.x.add(d.x), sy, xz.y.add(d.z));
  };
}

function oceanUniforms(g) {
  const u = {
    ...skyU(),
    ...shoreU(),
    uOffset: uniform(new THREE.Vector2()),
    uG: uniform(g),
    uDisp0: texture(new THREE.Texture()),
    uDisp1: texture(new THREE.Texture()),
    uDisp2: texture(new THREE.Texture()),
    uDer0: texture(new THREE.Texture()),
    uDer1: texture(new THREE.Texture()),
    uDer2: texture(new THREE.Texture()),
    uHs: uniform(1),
    uTexN: uniform(new THREE.Vector3(512, 512, 512)),
    uDetail: uniform(600),
    uDeep: uniform(new THREE.Color()),
    uShallow: uniform(new THREE.Color()),
    uTurb: uniform(0),
    uClarity: uniform(20),
    uShoreFoam: uniform(1),
    uSnap: uniform(new THREE.Vector2()),
    uCaust: uniform(1),
    uSharp: uniform(0.6),
    uCollFoam: uniform(1),
    uFoamCol: uniform(new THREE.Color(1, 1, 1)),
  };
  // 기존 코드가 정점용 사본(uTimeV/uCamV)도 갱신하므로 같은 노드를 가리키게 함
  return { ...u, uTimeV: u.uTime, uCamV: u.uCam };
}

const withUniforms = (m, u) => {
  m.uniforms = u;
  return m;
};

// 굴절/커스틱/디테일 (오션·해저 공용)
function waterFx(u, T) {
  const caustics = (xz, t) => {
    const w = xz
      .add(
        vec2(
          vnoise(vec3(xz.mul(0.09), t.mul(0.05))),
          vnoise(vec3(xz.mul(0.09).add(7.3), t.mul(0.05))),
        )
          .sub(0.5)
          .mul(5.0),
      )
      .toVar();
    return caustTile(rotS(w, 0.47).div(7.3), t.mul(0.35))
      .mul(0.6)
      .add(caustTile(rotS(w, 1.63).div(4.1).add(0.3), t.mul(0.45)).mul(0.4));
  };
  const optics = () => {
    const scat = float(0.015).add(u.uTurb.mul(u.uTurb).mul(0.55)).toVar();
    const absorb = log(clamp(u.uShallow, 0.02, 0.98))
      .negate()
      .div(u.uClarity)
      .mul(float(1).add(u.uTurb.mul(1.5)))
      .toVar();
    return { scat, absorb, ext: absorb.add(scat).toVar() };
  };
  return { caustics, optics };
}

export function makeOceanMatGPU(g) {
  const u = oceanUniforms(g);
  const L = lib(u),
    S = sampling(u, L.T),
    SL = shoreLib(u),
    FX = waterFx(u, L.T),
    disp = displacer(u);
  const T = L.T;
  const vXZ = varyingProperty("vec2", "vXZ"),
    vW = varyingProperty("vec3", "vW");
  const m = new MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    transparent: true,
  });
  m.fog = false;
  m.positionNode = Fn(() => {
    const w = disp(positionLocal).toVar();
    vXZ.assign(positionLocal.xz.add(u.uOffset));
    vW.assign(w);
    return w;
  })();
  const derB = (t, f, Lc, a, off, seed) => {
    const w = S.bombW(vXZ, Lc, seed).toVar();
    const n = float(1)
      .div(sqrt(w.mul(w).add(float(1).sub(w).mul(float(1).sub(w)))))
      .toVar();
    const u1 = S.cuv(vXZ, Lc, a, off).toVar(),
      u2 = S.cuv(vXZ, Lc, a + 2.17, off.add(vec2(0.41, 0.27))).toVar();
    const A = t.sample(u1).toVar(),
      B = t.sample(u2).toVar();
    const foam = max(
      f.sample(u1).w.mul(w),
      f.sample(u2).w.mul(float(1).sub(w)),
    ).mul(1.15);
    const d = vec4(
      rotS(A.xy, a)
        .mul(w)
        .mul(n)
        .add(
          rotS(B.xy, a + 2.17)
            .mul(float(1).sub(w))
            .mul(n),
        ),
      A.zw
        .mul(w)
        .add(B.zw.mul(float(1).sub(w)))
        .mul(n),
    );
    return { d: d.toVar(), foam: foam.toVar() };
  };
  const detailSlope = (xz, t) => {
    const e = 0.08;
    const p = xz
      .mul(1.7)
      .add(vec2(t.mul(0.35), t.mul(0.21)))
      .toVar();
    const tz = t.mul(0.3);
    const c = fbm(vec3(p, tz), 2).toVar();
    return vec2(
      fbm(vec3(p.add(vec2(e, 0)), tz), 2).sub(c),
      fbm(vec3(p.add(vec2(0, e)), tz), 2).sub(c),
    )
      .div(e)
      .mul(0.06);
  };
  const shoreDetail = (xz, dir, t) => {
    const perp = vec2(dir.y.negate(), dir.x).toVar();
    const q = vec2(dot(xz, dir).mul(0.7), dot(xz, perp).mul(0.22))
      .add(vec2(fbm(vec3(xz.mul(0.05), t.mul(0.05)), 2).mul(3.0), 0.0))
      .add(vec2(t.mul(0.25), 0.0))
      .toVar();
    const e = 0.1,
      tz = t.mul(0.2);
    const c = fbm(vec3(q, tz), 3).toVar();
    const ga = fbm(vec3(q.add(vec2(e, 0)), tz), 3)
        .sub(c)
        .div(e),
      gb = fbm(vec3(q.add(vec2(0, e)), tz), 3)
        .sub(c)
        .div(e);
    return dir.mul(ga).mul(0.7).add(perp.mul(gb).mul(0.22)).mul(0.25);
  };
  const lace = (xz, t) => {
    const w = xz
      .add(
        vec2(
          fbm(vec3(xz.mul(0.15), t.mul(0.05)), 2),
          fbm(vec3(xz.mul(0.15).add(9.0), t.mul(0.05)), 2),
        )
          .sub(0.5)
          .mul(6.0),
      )
      .toVar();
    const a = worley(w.mul(0.9), t.mul(0.6)),
      b = worley(rotS(w, 1.3).mul(2.1).add(3.7), t.mul(0.8));
    const l = float(1)
      .sub(smoothstep(0.0, 0.35, a).mul(0.6))
      .sub(smoothstep(0.0, 0.3, b).mul(0.4));
    return clamp(
      l.add(fbm(vec3(xz.mul(1.3), t.mul(0.1)), 2).mul(0.3)).sub(0.15),
      0.0,
      1.0,
    );
  };
  const out = Fn(() => {
    const uw = L.uwInit(vW, u.uCam);
    const toCam = u.uCam.sub(vW).toVar();
    const dist = length(toCam).toVar();
    const V = toCam.div(dist).toVar();
    const hd = length(toCam.xz).toVar();
    const near = hd.lessThan(u.uDetail);
    const m_ = S.ampMod(vXZ).toVar();
    const si = shoreInfo(vXZ).toVar();
    const wd0 = SL.waterDepth(si.x).toVar();
    const att0 = float(0.12)
        .add(smoothstep(0.5, 18.0, wd0).mul(0.88))
        .toVar(),
      att1 = smoothstep(0.4, 9.0, wd0).toVar();
    const sw = SL.swash(vXZ, si, T).toVar();
    const uv0 = S.cuv(vXZ, L0, R0, O0).toVar();
    const d0r = u.uDer0.sample(uv0).toVar();
    const d0 = vec4(rotS(d0r.xy, R0), d0r.zw).toVar();
    const f0 = u.uDisp0.sample(uv0).w.toVar();
    const D1 = derB(u.uDer1, u.uDisp1, L1, R1, O1, 1.3),
      D2 = derB(u.uDer2, u.uDisp2, L2, R2, O2, 4.7);
    const d1 = D1.d,
      d2 = D2.d;
    const w0 = mix(1.0, m_, 0.6).mul(att0).toVar(),
      w1 = m_.mul(att1).toVar(),
      w2 = m_
        .mul(att1)
        .mul(float(1).sub(smoothstep(800.0, 4000.0, dist)))
        .toVar();
    const ds = vec2(0).toVar();
    If(near, () => {
      ds.assign(detailSlope(vXZ, T));
    });
    const slope = d0.xy
      .mul(w0)
      .add(d1.xy.mul(w1))
      .add(d2.xy.mul(w2))
      .add(
        ds
          .mul(att1.mul(0.65).add(0.35))
          .mul(float(1).sub(smoothstep(30.0, 250.0, dist))),
      )
      .toVar();
    const sdir = select(
      dot(si.zw, si.zw).greaterThan(0.0),
      normalize(si.zw),
      vec2(1.0, 0.0),
    ).toVar();
    const sd2 = vec2(0).toVar();
    If(near, () => {
      sd2.assign(shoreDetail(vXZ, sdir, T));
    });
    slope.addAssign(
      sd2
        .mul(float(1).sub(att1))
        .mul(float(1).sub(smoothstep(40.0, 300.0, dist))),
    );
    slope.addAssign(sdir.negate().mul(sw.y));
    const pk = S.peakMod(vXZ).toVar();
    const jm = min(d0.z, d0.w).mul(w0).add(min(d1.z, d1.w).mul(w1)).toVar();
    const sh = float(1).add(u.uSharp.mul(1.2).mul(pk)).toVar();
    If(jm.lessThan(0.0), () => {
      sh.assign(min(sh, max(float(0.95).div(jm.negate()), 0.7)));
    });
    const jx = float(1)
      .add(d0.z.mul(w0).add(d1.z.mul(w1)).mul(sh))
      .add(d2.z.mul(w2))
      .toVar();
    const jz = float(1)
      .add(d0.w.mul(w0).add(d1.w.mul(w1)).mul(sh))
      .add(d2.w.mul(w2))
      .toVar();
    const Jc = jx.mul(jz);
    const crest0 = clamp(
      vW.y.div(u.uHs.mul(0.5)).mul(0.5).add(0.5),
      0.0,
      1.0,
    ).toVar();
    slope.mulAssign(
      float(1).add(
        u.uSharp
          .mul(pk)
          .mul(0.7)
          .mul(smoothstep(0.5, 0.95, crest0)),
      ),
    );
    const jmin = mix(0.25, 0.08, u.uSharp);
    slope.divAssign(vec2(max(jx, jmin), max(jz, jmin)));
    const N = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();
    const dN = fwidth(N);
    const nv = clamp(dot(dN, dN).mul(2.0), 0.0, 0.5);
    const rough = clamp(
      sqrt(float(0.008).add(m_.mul(0.01)).add(nv).add(dist.mul(2e-6))),
      0.07,
      0.6,
    ).toVar();
    const a2 = rough.mul(rough).mul(rough).mul(rough).toVar();
    const NdV = clamp(dot(N, V), 0.001, 1.0).toVar();
    const F = float(0.02).add(pow(float(1).sub(NdV), 5.0).mul(0.98));
    const R = reflect(V.negate(), N).toVar();
    const refl = L.sky(normalize(vec3(R.x, max(abs(R.y), 0.01), R.z)), 3, 0);
    const sunC = L.sunC;
    const H = normalize(u.uSun.add(V)).toVar();
    const NdH = max(dot(N, H), 0.0),
      NdL = max(dot(N, u.uSun), 0.0).toVar();
    const dd = NdH.mul(NdH).mul(a2.sub(1.0)).add(1.0).toVar();
    const D = a2.div(dd.mul(dd).mul(PI));
    const FH = float(0.02).add(
      pow(float(1).sub(max(dot(H, V), 0.0)), 5.0).mul(0.98),
    );
    const k = rough.mul(rough).mul(0.5).toVar();
    const Gs = NdL.div(NdL.mul(float(1).sub(k)).add(k)).mul(
      NdV.div(NdV.mul(float(1).sub(k)).add(k)),
    );
    const spec = sunC
      .mul(min(D.mul(FH).mul(Gs).div(NdV.mul(4.0).add(1e-3)), 60.0))
      .mul(float(1).sub(u.uClouds.mul(0.6)));
    const amb = u.uZenith.mul(0.35).add(u.uHorizon.mul(0.15)).toVar();
    const light = sunC.mul(max(u.uSun.y, 0.05)).mul(0.6).add(amb).toVar();
    const { scat, absorb, ext } = FX.optics();
    const Tv = refract(V.negate(), N, 1.0 / 1.333).toVar();
    If(dot(Tv, Tv).lessThan(1e-4), () => {
      Tv.assign(vec3(V.x.negate(), -0.3, V.z.negate()));
    });
    const depth = wd0.toVar();
    const path = vW.y.add(depth).div(max(Tv.y.negate(), 0.04)).toVar();
    const bed = vW.add(Tv.mul(path)).toVar();
    for (let it = 0; it < 2; it++) {
      const nd = SL.waterDepth(shoreInfo(bed.xz).x);
      depth.assign(select(near, nd, depth));
      path.assign(
        select(
          near,
          max(vW.y.add(depth), 0.0).div(max(Tv.y.negate(), 0.04)),
          path,
        ),
      );
      bed.assign(vW.add(Tv.mul(path)));
    }
    const sf = float(0.5).toVar();
    If(near, () => {
      sf.assign(fbm(vec3(bed.xz.mul(0.35), 3.0), 3));
    });
    const bedAlb = vec3(0.78, 0.7, 0.52).mul(sf.mul(0.25).add(0.75));
    const cfade = float(1).sub(
      smoothstep(0.0, 1.0, length(fwidth(bed.xz)).mul(0.6)),
    );
    const cv = float(0.12).toVar();
    If(near, () => {
      cv.assign(FX.caustics(bed.xz.add(Tv.xz.mul(0.5)), T));
    });
    const ca = mix(0.12, cv, cfade)
      .mul(float(1).sub(u.uTurb.mul(0.85)))
      .mul(float(1).sub(u.uClouds.mul(0.6)));
    const att = exp(ext.negate().mul(depth)).toVar();
    const sunDown = sunC.mul(max(u.uSun.y, 0.0)).mul(att);
    const bedCol = bedAlb.mul(
      sunDown.mul(ca.mul(3.0).add(0.55)).add(amb.mul(att).mul(0.6)),
    );
    const trans = exp(ext.negate().mul(path)).toVar();
    const milky = mix(u.uShallow, vec3(0.62, 0.66, 0.58), 0.55);
    const inscat = mix(
      u.uDeep,
      milky,
      clamp(u.uTurb.mul(0.9).add(0.1), 0.0, 1.0).mul(
        scat.div(scat.add(dot(absorb, vec3(0.333)))),
      ),
    )
      .mul(light)
      .toVar();
    const back = pow(
      clamp(
        dot(V, normalize(vec3(u.uSun.x.negate(), 0.0, u.uSun.z.negate()))),
        0.0,
        1.0,
      ),
      4.0,
    );
    inscat.addAssign(
      u.uShallow
        .mul(sunC)
        .mul(crest0.mul(crest0).mul(0.12).add(back.mul(crest0).mul(0.25)))
        .mul(float(1).sub(u.uTurb.mul(0.5))),
    );
    const water = bedCol.mul(trans).add(inscat.mul(float(1).sub(trans)));
    const col = mix(water, refl, F).add(spec).toVar();
    const reg = mix(0.35, 1.0, smoothstep(0.35, 1.2, m_)).mul(
      pk.mul(0.4).add(0.6),
    );
    const coll = smoothstep(0.8, 0.1, Jc);
    const steepF = smoothstep(0.3, 0.85, length(slope))
      .mul(smoothstep(0.55, 0.92, crest0))
      .mul(pk.mul(0.7).add(0.3));
    const foamA = clamp(
      clamp(f0.mul(0.8).add(D1.foam.mul(0.6)).add(D2.foam.mul(0.2)), 0.0, 1.0)
        .mul(u.uCollFoam.mul(0.5).add(0.7))
        .add(u.uCollFoam.mul(coll.mul(0.7).add(steepF.mul(0.5)))),
      0.0,
      1.0,
    )
      .mul(reg)
      .mul(att1);
    const d = si.y;
    const band = smoothstep(-1.5, 0.5, d).mul(smoothstep(5.0, 0.5, d));
    const shoreMask = u.uShoreFoam.mul(
      band.mul(0.75).mul(step(0.0, d)).add(sw.z.mul(0.9)).add(sw.w.mul(0.55)),
    );
    const mask = clamp(foamA.add(shoreMask), 0.0, 1.0).toVar();
    const lp = float(0.55).toVar();
    If(near, () => {
      lp.assign(lace(vXZ, T));
    });
    const pat = mix(lp, 0.55, smoothstep(80.0, 600.0, dist)).toVar();
    const fw = max(fwidth(pat), 0.06);
    const foam = smoothstep(
      float(1).sub(mask).sub(fw),
      float(1).sub(mask).add(fw),
      pat,
    )
      .mul(smoothstep(0.0, 0.08, mask))
      .mul(float(1).sub(smoothstep(1500.0, 6000.0, dist)))
      .toVar();
    const foamC = u.uFoamCol
      .mul(amb.mul(1.6).add(sunC.mul(0.55).mul(max(N.y, 0.0))))
      .toVar();
    col.assign(mix(col, foamC, foam.mul(0.95)));
    const fog = float(1).sub(exp(dist.mul(-0.000035)));
    col.assign(
      mix(
        col,
        L.sky(normalize(vec3(V.x.negate(), 0.015, V.z.negate())), 0, 0),
        pow(fog, 1.4),
      ),
    );
    const alpha = smoothstep(0.0, 0.35, vW.y.sub(si.x)).toVar();
    If(uw.under.greaterThan(0.001), () => {
      const Nd = N.negate(),
        I = V.negate();
      const Ta = refract(I, Nd, 1.333).toVar();
      const rd = reflect(I, Nd).toVar();
      const below = L.uwMedium(
        normalize(vec3(rd.x, min(rd.y, -0.02), rd.z)),
      ).toVar();
      const uc = below.toVar();
      If(dot(Ta, Ta).greaterThanEqual(1e-4), () => {
        const c1 = abs(dot(V, N));
        const Fw = max(
          float(0.02).add(pow(float(1).sub(c1), 5.0).mul(0.98)),
          smoothstep(0.76, 0.66, c1),
        );
        uc.assign(
          mix(
            L.sky(normalize(Ta), 3, 1).mul(0.9).add(foamC.mul(foam).mul(0.6)),
            below,
            Fw,
          ),
        );
      });
      uc.assign(L.underFog(uc, dist, V.negate()));
      col.assign(mix(col, uc, uw.under));
      alpha.assign(mix(alpha, 1.0, uw.under));
    });
    alpha.assign(mix(alpha, 1.0, uw.men));
    return vec4(L.meniscus(col, uw.men), alpha);
  })();
  m.colorNode = out.xyz;
  m.opacityNode = out.w;
  return withUniforms(m, u);
}

export function makeSkyMatGPU() {
  const u = skyU();
  const L = lib(u);
  const m = new MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
  });
  m.fog = false;
  m.colorNode = Fn(() => {
    const vW = positionWorld;
    const uw = L.uwInit(vW, u.uCam);
    const d = normalize(vW.sub(u.uCam)).toVar();
    const c = L.sky(d, 5, 1).toVar();
    If(uw.under.greaterThan(0.001), () => {
      c.assign(mix(c, L.uwMedium(d), uw.under));
    });
    return L.meniscus(c, uw.men);
  })();
  return withUniforms(m, u);
}

export function makeIslandMatGPU() {
  const u = { ...skyU(), ...shoreU(), uBedOn: uniform(0) };
  const L = lib(u),
    SL = shoreLib(u),
    T = L.T;
  const m = new MeshBasicNodeMaterial();
  m.fog = false;
  m.colorNode = Fn(() => {
    const vWp = positionWorld.toVar();
    Discard(u.uBedOn.greaterThan(0.5).and(vWp.y.lessThan(-0.4)));
    const uw = L.uwInit(vWp, u.uCam);
    const n = normalize(normalWorld).toVar();
    const sunC = L.sunC;
    const amb = u.uZenith.mul(0.5).add(u.uHorizon.mul(0.25)).toVar();
    const si = shoreInfo(vWp.xz).toVar();
    const x = si.y.negate().toVar();
    const wet = float(0).toVar(),
      foamL = float(0).toVar();
    If(
      u.uShoreA.greaterThan(0.0).and(x.greaterThan(-2.0)).and(x.lessThan(40.0)),
      () => {
        const ru = SL.runup(vWp.xz, T).toVar();
        const s = ru.x,
          R = ru.y,
          F = ru.z,
          a = ru.w;
        const P = float(6.28318)
          .div(sqrt(float(9.81 * 6.28318).div(u.uShoreLen)).mul(0.75))
          .toVar();
        const sd = select(
          x.lessThan(R),
          a.add(
            float(1)
              .sub(a)
              .mul(acos(pow(clamp(x.div(R), 0.0, 1.0), 1.0 / 1.4)))
              .div(1.5708),
          ),
          float(2.0),
        ).toVar();
        const cur = select(
          x.lessThan(F),
          float(1.0),
          select(
            s.greaterThan(sd),
            exp(s.sub(sd).negate().mul(P).div(5.0)),
            float(0.0),
          ),
        );
        wet.assign(
          max(
            max(cur, smoothstep(R.mul(1.25).add(0.8), R.mul(0.2), x).mul(0.5)),
            float(1).sub(smoothstep(-1.0, 0.5, x)),
          ),
        );
        const edge = smoothstep(R.sub(0.9), R.sub(0.15), x).mul(
          smoothstep(R.add(0.35), R, x),
        );
        foamL.assign(
          edge
            .mul(
              select(
                s.greaterThan(a),
                exp(s.sub(a).negate().mul(P).div(3.0)),
                float(0.0),
              ),
            )
            .mul(step(F, x))
            .mul(
              smoothstep(0.35, 0.65, fbm(vec3(vWp.xz.mul(1.7), T.mul(0.1)), 2)),
            ),
        );
      },
    );
    const alb = attribute("color", "vec3").mul(mix(1.0, 0.55, wet));
    const V = normalize(u.uCam.sub(vWp)).toVar();
    const H = normalize(u.uSun.add(V));
    const col = alb
      .mul(sunC.mul(max(dot(n, u.uSun), 0.0)).add(amb))
      .add(
        sunC
          .mul(wet)
          .mul(0.25)
          .mul(pow(max(dot(n, H), 0.0), 60.0)),
      )
      .toVar();
    col.assign(
      mix(
        col,
        vec3(0.92, 0.95, 0.95).mul(amb.mul(1.6).add(sunC.mul(0.55))),
        foamL.mul(0.85),
      ),
    );
    const dist = length(u.uCam.sub(vWp)).toVar();
    col.assign(
      mix(
        col,
        L.sky(normalize(vec3(V.x.negate(), 0.015, V.z.negate())), 0, 0),
        pow(float(1).sub(exp(dist.mul(-0.000035))), 1.4),
      ),
    );
    If(uw.under.greaterThan(0.001), () => {
      col.assign(
        mix(
          col,
          L.underFog(
            col.mul(mix(1.0, 0.6, step(vWp.y, 0.0))),
            dist,
            V.negate(),
          ),
          uw.under,
        ),
      );
    });
    return L.meniscus(col, uw.men);
  })();
  return withUniforms(m, u);
}

// 해저: 오션과 같은 유니폼 객체 공유
export function makeSeabedGPU(ocean) {
  const u = ocean.uniforms;
  const L = lib(u),
    FX = waterFx(u, L.T);
  const g = new THREE.PlaneGeometry(640, 640, 256, 256);
  g.rotateX(-Math.PI / 2);
  const vW = varyingProperty("vec3", "vWb");
  const m = new MeshBasicNodeMaterial();
  m.fog = false;
  m.positionNode = Fn(() => {
    const p = positionLocal.add(vec3(u.uSnap.x, 0.0, u.uSnap.y)).toVar();
    const h = max(shoreInfo(p.xz).x, u.uDepth.negate());
    const q = vec3(p.x, min(h, 0.5).sub(0.03), p.z);
    vW.assign(q);
    return q;
  })();
  m.colorNode = Fn(() => {
    const uw = L.uwInit(vW, u.uCam);
    const toCam = u.uCam.sub(vW).toVar();
    const dist = length(toCam).toVar();
    const V = toCam.div(dist).toVar();
    const n0 = normalize(cross(dFdx(vW), dFdy(vW))).toVar();
    const n = select(n0.y.lessThan(0.0), n0.negate(), n0).toVar();
    const depth = max(vW.y.negate(), 0.0).toVar();
    const { ext } = FX.optics();
    const sunC = L.sunC;
    const amb = u.uZenith.mul(0.35).add(u.uHorizon.mul(0.15)).toVar();
    const sand = float(0.75).add(fbm(vec3(vW.xz.mul(0.35), 3.0), 3).mul(0.25));
    const rip = float(0.5).add(
      sin(
        dot(vW.xz, vec2(1.9, 1.1)).add(
          vnoise(vec3(vW.xz.mul(0.15), 1.0)).mul(3.0),
        ),
      ).mul(0.5),
    );
    const alb = vec3(0.78, 0.7, 0.52).mul(sand).mul(rip.mul(0.12).add(0.88));
    const cfade = float(1).sub(
      smoothstep(0.0, 1.0, length(fwidth(vW.xz)).mul(0.6)),
    );
    const ca = mix(0.12, FX.caustics(vW.xz, L.T), cfade)
      .mul(float(1).sub(u.uTurb.mul(0.85)))
      .mul(float(1).sub(u.uClouds.mul(0.6)))
      .mul(u.uCaust);
    const down = exp(ext.negate().mul(depth)).toVar();
    const col = alb
      .mul(
        sunC
          .mul(max(dot(n, u.uSun), 0.0))
          .mul(down)
          .mul(ca.mul(3.0).add(0.55))
          .add(amb.mul(down).mul(0.6)),
      )
      .toVar();
    const tr = exp(ext.negate().mul(depth).div(max(V.y, 0.1))).toVar();
    const above = col
      .mul(tr)
      .add(
        u.uDeep
          .mul(sunC.mul(max(u.uSun.y, 0.05)).mul(0.6).add(amb))
          .mul(float(1).sub(tr)),
      );
    return L.meniscus(
      mix(above, L.underFog(col, dist, V.negate()), uw.under),
      uw.men,
    );
  })();
  return { g, m: withUniforms(m, u) };
}

// 파고 프로브: 근평면 스트립 + 카메라/큐브 샘플 (풀스크린 삼각형 → probeRT)
export function makeProbeGPU(ocean) {
  const pts = Array.from({ length: MAX_PTS }, () => new THREE.Vector2());
  const u = {
    ...ocean.uniforms,
    uNearL: uniform(new THREE.Vector3()),
    uNearR: uniform(new THREE.Vector3()),
    uStripN: uniform(STRIP),
    uNPts: uniform(0),
  };
  const uPts = uniformArray(pts, "vec2");
  const disp = displacer(u);
  const m = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  m.toneMapped = false;
  m.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
  m.fragmentNode = Fn(() => {
    const sc = screenCoordinate;
    const o = vec3(0).toVar(),
      drift = vec2(0).toVar(),
      valid = float(1).toVar();
    If(sc.y.lessThan(1.0), () => {
      o.assign(mix(u.uNearL, u.uNearR, sc.x.div(u.uStripN)));
    }).Else(() => {
      const i = int(sc.x).toVar();
      If(i.greaterThan(0).and(float(i).lessThanEqual(u.uNPts)), () => {
        const q = uPts.element(i.sub(1)).toVar();
        o.assign(vec3(q.x, 0.0, q.y));
        drift.assign(disp(o).xz.sub(u.uOffset.add(q)));
      }).ElseIf(i.greaterThan(0), () => {
        valid.assign(0.0);
      });
    });
    const Tt = u.uOffset.add(o.xz).toVar();
    const p = vec3(o.x, 0.0, o.z).toVar(),
      w = vec3(0).toVar();
    Loop(4, () => {
      w.assign(disp(p));
      p.assign(vec3(p.x.sub(w.x.sub(Tt.x)), p.y, p.z.sub(w.z.sub(Tt.y))));
    });
    return select(valid.greaterThan(0.5), vec4(w.y, drift, 1.0), vec4(0.0));
  })();
  const tri = new THREE.BufferGeometry();
  tri.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  const mesh = new THREE.Mesh(tri, m);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  withUniforms(m, { ...u, uPts: { value: pts } });
  return {
    m,
    scene,
    // WebGPURenderer는 render 시 updateProjectionMatrix를 호출 → 실제 카메라 필요 (정점은 vertexNode가 직접 클립 좌표로 출력)
    cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    k: 0,
    busy: false,
    h: 0,
    under: false,
    blend: 0,
  };
}
