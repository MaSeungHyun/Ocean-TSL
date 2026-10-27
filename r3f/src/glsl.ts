// 두 엔진이 공유하는 GLSL (GLSL ES 1 스타일 → three/Babylon 모두 WebGL2에서 300 es로 변환)
export const PI2 = 6.283185307

// ---------- FFT 파이프라인 프래그먼트 패스 (gl_FragCoord 기반, 정점 varying 불필요) ----------
const head = `precision highp float;\n`
export const evolveFS = head + `
uniform sampler2D uH0; uniform float uN; uniform float uL; uniform float uTime; uniform float uWhich;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
vec2 pack(vec2 a, vec2 b){ return vec2(a.x-b.y, a.y+b.x); }  // a + i·b
void main(){
  vec2 p = floor(gl_FragCoord.xy);
  vec2 n = p - step(uN*0.5, p)*uN;
  vec2 k = ${PI2}*n/uL; float kl = max(length(k), 1e-6);
  float w = sqrt(9.81*kl);
  vec4 h0 = texture2D(uH0, (p+0.5)/uN);
  vec2 e = vec2(cos(w*uTime), sin(w*uTime));
  vec2 h = cmul(h0.xy, e) + cmul(h0.zw, vec2(e.x, -e.y));
  vec2 ih = vec2(-h.y, h.x);
  if (uWhich < 0.5) {
    vec2 Dx = ih*k.x/kl, Dz = ih*k.y/kl, Dyx = ih*k.x;
    gl_FragColor = vec4(pack(Dx, h), pack(Dz, Dyx));
  } else {
    vec2 Dyz = ih*k.y, Dxx = -h*k.x*k.x/kl, Dzz = -h*k.y*k.y/kl, Dxz = -h*k.x*k.y/kl;
    gl_FragColor = vec4(pack(Dyz, Dxx), pack(Dzz, Dxz));
  }
}`
// Stockham radix-2 역 FFT 한 단계 (두 복소 신호를 RG/BA로 동시 처리)
export const fftFS = head + `
uniform sampler2D uSrc; uniform float uN; uniform float uSub; uniform float uHoriz;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
void main(){
  vec2 p = floor(gl_FragCoord.xy);
  float idx = mix(p.y, p.x, uHoriz);
  float hs = uSub*0.5;
  float ev = floor(idx/uSub)*hs + mod(idx, hs);
  vec2 ce = mix(vec2(p.x, ev), vec2(ev, p.y), uHoriz);
  vec2 co = ce + mix(vec2(0.0, uN*0.5), vec2(uN*0.5, 0.0), uHoriz);
  vec4 A = texture2D(uSrc, (ce+0.5)/uN), B = texture2D(uSrc, (co+0.5)/uN);
  float a = ${PI2}*idx/uSub; vec2 t = vec2(cos(a), sin(a));
  gl_FragColor = vec4(A.xy + cmul(t, B.xy), A.zw + cmul(t, B.zw));
}`
// 최종 변위 + 야코비안 거품(시간 누적/감쇠)
export const dispFS = head + `
uniform sampler2D uA; uniform sampler2D uB; uniform sampler2D uPrev; uniform float uN;
uniform float uLambda; uniform float uDt; uniform float uFoamDecay; uniform float uFoamThr;
void main(){
  vec2 uv = (floor(gl_FragCoord.xy)+0.5)/uN;
  vec4 a = texture2D(uA, uv), b = texture2D(uB, uv);
  float J = (1.0+uLambda*b.y)*(1.0+uLambda*b.z) - uLambda*uLambda*b.w*b.w;
  float prev = texture2D(uPrev, uv).w;
  float inj = smoothstep(uFoamThr, uFoamThr-0.45, J);
  float foam = clamp(max(prev*exp(-uDt*uFoamDecay), inj), 0.0, 1.0);
  gl_FragColor = vec4(uLambda*a.x, a.y, uLambda*a.z, foam);
}`
export const derivFS = head + `
uniform sampler2D uA; uniform sampler2D uB; uniform float uN; uniform float uLambda;
void main(){
  vec2 uv = (floor(gl_FragCoord.xy)+0.5)/uN;
  vec4 a = texture2D(uA, uv), b = texture2D(uB, uv);
  gl_FragColor = vec4(a.w, b.x, uLambda*b.y, uLambda*b.z);
}`

// ---------- 공용 함수 (하늘/노이즈) ----------
export const common = `
uniform float uTime; uniform vec3 uSun; uniform vec3 uSunColor; uniform float uSunI;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform float uClouds;
float hash(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*f*(f*(f*6.0-15.0)+10.0);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p,int o){ float a=0.5,s=0.0; for(int i=0;i<6;i++){ if(i>=o) break; s+=a*vnoise(p); p=vec3(0.8*p.x-0.6*p.y, 0.6*p.x+0.8*p.y, p.z)*2.03+vec3(1.7,9.2,0.0); a*=0.5;} return s; }
vec2 rot2(vec2 v, float a){ float c=cos(a), s=sin(a); return vec2(c*v.x-s*v.y, s*v.x+c*v.y); }
// 대규모 저주파 변조 (수백 m 스케일) → 진폭/거품 불균일
float bigMod(vec2 xz){ return fbm(vec3(xz*0.0016, uTime*0.004), 3); }
// ---- 수중 (카메라가 실제 파면 아래일 때 uUnder → 1) ----
uniform float uUnderG; uniform vec3 uUWCol; uniform float uUWDens; uniform float uCamDepth;
// 채널별 소광계수 (Beer-Lambert): 지정 색이 가장 멀리 투과되도록 -log(색) 기반, 밀도로 스케일
// 픽셀 단위 수면 분할: uWL = 근평면 가로 스트립의 실제 파고(R), 이 픽셀의 근평면 점 높이와 비교
uniform float uSplit; uniform sampler2D uWL; uniform vec2 uRes; uniform vec3 uCamF; uniform float uNear;
float uUnder; float uMen;
void uwInit(vec3 wp, vec3 cam){
  uUnder = uUnderG; uMen = 0.0;
  if (uSplit > 0.001){
    vec3 d = normalize(wp - cam); vec3 np = cam + d*(uNear/max(dot(d, uCamF), 0.05));
    float h = texture2D(uWL, vec2(gl_FragCoord.x/uRes.x, 0.25)).r;
    float e = h - np.y + 0.0015*sin(gl_FragCoord.x*0.045 + uTime*3.0);
    uUnder = mix(uUnderG, smoothstep(-0.0015, 0.0015, e), uSplit);
    uMen = uSplit*(1.0 - smoothstep(0.0, 0.006, abs(e - 0.0015)));
  }
}
vec3 meniscus(vec3 c){ return mix(c, c*0.35 + uUWCol*0.08, uMen*0.8); }
vec3 uwExt(){ return uUWDens*(0.25 - log(clamp(uUWCol*1.6, 0.03, 0.97))); }
// 수중 산란광 (시선 방향 dir: 카메라→바깥): 위쪽 밝고 아래 어두움 + 수면 아래 갓레이
vec3 uwMedium(vec3 dir){
  vec3 sunC = uSunColor*uSunI;
  vec3 light = (sunC*max(uSun.y, 0.05)*0.55 + uZenith*0.4 + uHorizon*0.15)*exp(-uwExt()*max(uCamDepth, 0.0)*0.6);
  vec3 c = uUWCol*light*mix(0.25, 1.25, smoothstep(-0.9, 0.8, dir.y));
  vec3 sd = normalize(vec3(uSun.x, max(uSun.y, 0.1)*1.333 + 0.3, uSun.z));   // 굴절된 태양 방향 (대략)
  float cs = max(dot(dir, sd), 0.0);
  vec2 q = dir.xz/(abs(dir.y) + 0.25);
  float rays = vnoise(vec3(q*vec2(3.0, 9.0), uTime*0.25))*vnoise(vec3(q*vec2(7.0, 2.5) + 4.0, uTime*0.35));
  c += uUWCol*sunC*(pow(cs, 6.0)*0.35 + pow(cs, 3.0)*rays*0.9)*smoothstep(-0.2, 0.5, dir.y);
  return c;
}
vec3 underFog(vec3 col, float dist, vec3 dir){ vec3 T = exp(-uwExt()*dist); return col*T + uwMedium(dir)*(1.0 - T); }
vec3 sky(vec3 d, int oct, float disk){
  float y=max(d.y,0.0);
  vec3 col=mix(uHorizon,uZenith,pow(y,0.5));
  col=mix(col,uHorizon*0.85,smoothstep(0.0,-0.08,d.y));
  float s=max(dot(d,uSun),0.0); vec3 sc=uSunColor*uSunI;
  col+=sc*(pow(s,6.0)*0.12+pow(s,90.0)*0.5);
  col+=sc*smoothstep(0.99955,0.9998,s)*(1.0-uClouds*0.7)*30.0*disk;
  if(oct>0){
    vec2 uv=d.xz/(d.y+0.12)*0.9+vec2(uTime*0.004,uTime*0.0015);
    float n=fbm(vec3(uv*1.6,uTime*0.003),oct);
    float c=smoothstep(1.05-uClouds*0.8,1.25-uClouds*0.7,n*1.75)*smoothstep(0.0,0.12,d.y);
    vec3 lit=uSunColor*(uSunI*0.35+0.25)*mix(0.75,1.15,pow(s,4.0));
    col=mix(col,mix(uHorizon*0.6,lit,clamp(n*1.4-0.3,0.0,1.0)),c*0.92);
  }
  return col;
}`

export const skyFS = head + common + `
uniform vec3 uCam; varying vec3 vW; void main(){ uwInit(vW, uCam); vec3 d = normalize(vW-uCam); vec3 c = uUnder > 0.001 ? mix(sky(d,5,1.0), uwMedium(d), uUnder) : sky(d,5,1.0); gl_FragColor=vec4(meniscus(c),1.0); }`

// ---------- 바다 표면 ----------
const oceanUniforms = `
uniform sampler2D uDisp0; uniform sampler2D uDisp1; uniform sampler2D uDisp2;
uniform sampler2D uDer0; uniform sampler2D uDer1; uniform sampler2D uDer2;
uniform vec3 uL; uniform vec3 uRot; uniform vec4 uOff01; uniform vec2 uOff2; uniform vec3 uIsland; uniform float uHs; uniform vec3 uTexN; uniform float uDetail;
`
// 공통 샘플링 로직: 캐스케이드 회전 + 텍스처 바밍(서로 다른 회전/오프셋 2회 샘플을 저주파 노이즈로 분산 보존 블렌딩)
const sampling = (NOISE: string, TIME: string) => `
vec2 rotS(vec2 v, float a){ float c=cos(a), s=sin(a); return vec2(c*v.x-s*v.y, s*v.x+c*v.y); }
// 대규모 진폭 변조 (0.3~1.7): 바람 돌풍 영역처럼 파고가 지역마다 달라짐
float ampMod(vec2 xz){ return 0.3 + 1.4*clamp(${NOISE}(vec3(xz*0.0011, ${TIME}*0.003))*0.65 + ${NOISE}(vec3(xz*0.0037+5.3, ${TIME}*0.006))*0.35, 0.0, 1.0); }
// 블렌딩 가중치: 타일 크기의 수 배 스케일 노이즈 → 타일 경계와 정렬되지 않음
float bombW(vec2 xz, float L, float seed){ return smoothstep(0.25, 0.75, ${NOISE}(vec3(xz/(L*2.37), seed))); }
vec2 cuv(vec2 xz, float L, float a, vec2 off){ return rotS(xz, -a)/L + off; }
uniform float uSharp;
// 지역별 뾰족함 (0~1): 일부 해역은 뾰족한 마루, 다른 곳은 둥근 너울
float peakMod(vec2 xz){ return smoothstep(0.32, 0.72, ${NOISE}(vec3(xz*0.0008 + 17.0, ${TIME}*0.0025))*0.7 + ${NOISE}(vec3(xz*0.0029 + 3.1, ${TIME}*0.005))*0.3); }
`
// 해안 거리장 + 해안 파도 (스워시)
const shoreLib = (NOISE: string) => `
uniform sampler2D uShore; uniform vec3 uShoreRect; uniform float uShoreA; uniform float uShoreLen; uniform float uDepth;
// x: 지형 높이(월드 y), y: 물가까지 부호 거리(m, 물 쪽 +), zw: 해안 방향 단위벡터
vec4 shoreInfo(vec2 xz){
  vec2 uv = (xz - uShoreRect.xy)/uShoreRect.z;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(-1000.0, 1000.0, 0.0, 0.0);
  // 수동 바이리니어: float 텍스처 선형 필터 미지원(NEAREST 폴백) 시 2m 텍셀 계단/격자 방지
  vec2 st = uv*512.0 - 0.5; vec2 i0 = floor(st), fr = st - i0; fr = fr*fr*(3.0 - 2.0*fr);
  vec2 t0 = (i0 + 0.5)/512.0, dt = vec2(1.0/512.0, 0.0);
  vec4 a = textureLod(uShore, t0, 0.0), b = textureLod(uShore, t0 + dt.xy, 0.0), c = textureLod(uShore, t0 + dt.yx, 0.0), e = textureLod(uShore, t0 + dt.xx, 0.0);
  return mix(mix(a, b, fr.x), mix(c, e, fr.x), fr.y);
}
float waterDepth(float h){ return clamp(-h, 0.0, uDepth); }
float hash1(float n){ return fract(sin(n*12.9898 + 4.1)*43758.5453); }
// 해안 파: 위상이 시간에 따라 증가 → 마루가 바다(d>0)에서 해안(d=0)으로 진행
// 반환 (x: 해안에서 사이클 진행도 s∈[0,1), y: 이번 파의 최대 처오름 R(m, 수평), z: 현재 물 앞머리 F(m), w: 처오름 비율 a)
vec4 runup(vec2 xz, float t){
  float k = 6.28318/uShoreLen, om = sqrt(9.81*k)*0.75;
  float ph0 = t*om + ${NOISE}(vec3(xz*0.011, t*0.015))*7.0;           // d=0 에서의 위상 (해안선 따라 도착 시각이 다름)
  float cyc = (ph0 - 1.5708)/6.28318, n = floor(cyc), s = cyc - n;
  float var = 0.55 + 0.9*${NOISE}(vec3(xz*0.025, 2.0 + t*0.01));
  float wv = mix(0.45, 1.35, hash1(n))*mix(0.7, 1.15, ${NOISE}(vec3(xz*0.06, n*1.7)));   // 파마다 / 구간마다 다른 세기
  float R = uShoreA*var*wv*8.0 + 0.3;
  float a = 0.32;
  float f = s < a ? sin(s/a*1.5708) : pow(cos((s - a)/(1.0 - a)*1.5708), 1.4);
  float F = R*f + (${NOISE}(vec3(xz*0.35, t*0.2)) - 0.5)*0.8*f;          // 앞머리 굴곡
  return vec4(s, R, F, a);
}
// 반환: (높이(절대 y), 거리방향 미분 dh/dd, 앞머리 거품, 잔류/역류 거품)
vec4 swash(vec2 xz, vec4 si, float t){
  float d = si.y;
  if (d > 95.0 || uShoreA <= 0.0) return vec4(0.0);
  float k = 6.28318/uShoreLen;
  vec4 ru = runup(xz, t);
  float s = ru.x, R = ru.y, F = ru.z, up = 1.0 - smoothstep(ru.w - 0.05, ru.w + 0.05, s);
  if (d < 0.0){
    // 육지: 물막이 지형을 따라 F 까지 올라왔다(스워시) 내려감(백워시)
    float x = -d;
    if (x > R*1.6 + 3.0) return vec4(si.x - 0.6, 0.0, 0.0, 0.0);
    float inside = F - x;
    float film = inside > 0.0 ? 0.035 + mix(0.12, 0.3, up)*sqrt(clamp(inside/max(F, 0.5), 0.0, 1.0)) : -0.5 + min(inside, 0.0)*0.05;
    float lead = smoothstep(-0.2, -1.8, x - F)*step(x, F + 0.05)*mix(0.45, 1.0, up);
    float back = (1.0 - up)*smoothstep(0.0, 1.5, inside)*0.55;           // 빠지는 물 위의 얇은 거품 줄
    return vec4(si.x + film, -0.08, lead, back);
  }
  float ph = s*6.28318 + 1.5708 + d*k;      // 바다 쪽: 같은 위상장 (d가 클수록 늦게 → 해안으로 진행)
  float env = smoothstep(95.0, 30.0, d);
  float shoal = 1.0 + 1.6*smoothstep(30.0, 2.0, d);
  float steep = mix(1.0, 5.0, smoothstep(45.0, 2.0, d));
  float c = 0.5 + 0.5*sin(ph), p = pow(c, steep);
  float var = 0.55 + 0.9*${NOISE}(vec3(xz*0.025, 2.0 + t*0.01));
  float A = uShoreA*env*shoal*var*0.5;
  float dp = steep*pow(max(c, 1e-3), steep - 1.0)*0.5*cos(ph)*k;
  // 해안선 근처: 부서진 파고를 물막이 높이로 이어 붙임
  float b = smoothstep(0.0, 6.0, d);
  float film0 = F > 0.0 ? 0.035 + mix(0.12, 0.3, up) : 0.0;
  float h = A*p*b + film0*(1.0 - b);
  float lead = smoothstep(0.8, 0.985, c)*smoothstep(28.0, 3.0, d)*var + (1.0 - b)*up*0.5;
  float behind = fract((ph - 1.5708)/6.28318);
  float linger = exp(-behind*5.0)*smoothstep(22.0, 1.0, d)*var;
  return vec4(h, A*dp*b, lead, linger);
}
`
export const oceanVSBody = oceanUniforms + `
uniform vec2 uOffset; uniform float uG; uniform vec3 uCamV; uniform float uTimeV;
varying vec2 vXZ; varying vec3 vW; varying float vH;
float hashv(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*f*(f*(f*6.0-15.0)+10.0);
 return mix(mix(mix(hashv(i),hashv(i+vec3(1,0,0)),f.x),mix(hashv(i+vec3(0,1,0)),hashv(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hashv(i+vec3(0,0,1)),hashv(i+vec3(1,0,1)),f.x),mix(hashv(i+vec3(0,1,1)),hashv(i+vec3(1,1,1)),f.x),f.y),f.z); }
${sampling('vn', 'uTimeV')}
${shoreLib('vn')}
vec3 casc(sampler2D t, vec2 xz, float L, float a, vec2 off, float lod){
  vec3 d = textureLod(t, cuv(xz, L, a, off), lod).xyz;
  vec2 h = rotS(d.xz, a); return vec3(h.x, d.y, h.y);
}
vec3 cascB(sampler2D t, vec2 xz, float L, float a, vec2 off, float spacing, float seed, float tn){
  float lod = max(0.0, log2(spacing*tn/L) + 0.5);   // 그리드 간격보다 작은 파는 밉맵으로 걸러냄
  float w = bombW(xz, L, seed);
  vec3 A = casc(t, xz, L, a, off, lod), B = casc(t, xz, L, a + 2.17, off + vec2(0.41, 0.27), lod);
  return (A*w + B*(1.0-w))/sqrt(w*w + (1.0-w)*(1.0-w));
}
vec3 oceanDisplace(vec3 local){
  vec2 xz = local.xz + uOffset;
  float r = length(local.xz);
  float spacing = max(r*uG, 0.05);
  float hd = max(length(vec3(xz.x, 0.0, xz.y) - uCamV), 1.0);
  float m = ampMod(xz);
  vec4 si = shoreInfo(xz); float wd = waterDepth(si.x);
  // 수심 기반 감쇠: 얕을수록 FFT 파(특히 중/소 캐스케이드)를 줄임
  float att0 = 0.12 + 0.88*smoothstep(0.5, 18.0, wd), att1 = smoothstep(0.4, 9.0, wd);
  float lod0 = max(0.0, log2(spacing*uTexN.x/uL.x) + 0.5);
  float w0 = mix(1.0, m, 0.6)*att0, w1 = m*att1;
  vec3 c01 = casc(uDisp0, xz, uL.x, uRot.x, uOff01.xy, lod0)*w0 + cascB(uDisp1, xz, uL.y, uRot.y, uOff01.zw, spacing, 1.3, uTexN.y)*w1;
  // 뾰족함: 대/중 캐스케이드 수평 변위를 지역별로 키우되, 야코비안이 0.05 아래로 접히지 않게 제한
  float lod1 = max(0.0, log2(spacing*uTexN.y/uL.y) + 0.5);
  vec4 j0 = textureLod(uDer0, cuv(xz, uL.x, uRot.x, uOff01.xy), lod0), j1 = textureLod(uDer1, cuv(xz, uL.y, uRot.y, uOff01.zw), lod1);
  float jm = min(j0.z, j0.w)*w0 + min(j1.z, j1.w)*w1;
  float sh = 1.0 + uSharp*1.2*peakMod(xz);
  if (jm < 0.0) sh = min(sh, max(0.95/(-jm), 0.7));
  c01.xz *= sh;
  vec3 d = c01
         + cascB(uDisp2, xz, uL.z, uRot.z, uOff2, spacing, 4.7, uTexN.z)*m*att1*(1.0-smoothstep(150.0, 600.0, hd));
  d *= (1.0 - smoothstep(9000.0, 24000.0, r))*smoothstep(-0.5, 3.0, si.y);   // 육지 위에서는 FFT 파 제거 (물막이만)
  d.y += swash(xz, si, uTimeV).x;
  vXZ = xz; vH = d.y; vW = vec3(xz.x + d.x, d.y, xz.y + d.z);
  return vW;
}`

const foamLib = `
vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p)*43758.5453); }
// Worley F2-F1: 셀 경계에서 0 → 레이스 모양 거품 네트워크
float worley(vec2 p, float t){
  vec2 i = floor(p), f = fract(p); float F1 = 8.0, F2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y)); vec2 r = hash2(i + o); r = 0.5 + 0.4*sin(t + 6.2831*r);
    vec2 dv = o + r - f; float dd = dot(dv, dv);
    if (dd < F1){ F2 = F1; F1 = dd; } else if (dd < F2) F2 = dd; }
  return sqrt(F2) - sqrt(F1);
}
float lace(vec2 xz, float t){
  vec2 w = xz + (vec2(fbm(vec3(xz*0.15, t*0.05), 2), fbm(vec3(xz*0.15 + 9.0, t*0.05), 2)) - 0.5)*6.0;
  float a = worley(w*0.9, t*0.6), b = worley(rotS(w, 1.3)*2.1 + 3.7, t*0.8);
  float l = 1.0 - smoothstep(0.0, 0.35, a)*0.6 - smoothstep(0.0, 0.3, b)*0.4;
  return clamp(l + fbm(vec3(xz*1.3, t*0.1), 2)*0.3 - 0.15, 0.0, 1.0);
}
// 마스크가 클수록 패턴의 더 많은 부분이 거품이 됨, fwidth로 가장자리 안티에일리어싱
float foamCover(float mask, float pat){ float w = max(fwidth(pat), 0.06); return smoothstep(1.0 - mask - w, 1.0 - mask + w, pat)*smoothstep(0.0, 0.08, mask); }
vec2 shoreDetail(vec2 xz, vec2 dir, float t){
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 q = vec2(dot(xz, dir)*0.7, dot(xz, perp)*0.22) + vec2(fbm(vec3(xz*0.05, t*0.05), 2)*3.0, 0.0) + vec2(t*0.25, 0.0);
  float e = 0.1, c = fbm(vec3(q, t*0.2), 3);
  float ga = (fbm(vec3(q + vec2(e, 0.0), t*0.2), 3) - c)/e, gb = (fbm(vec3(q + vec2(0.0, e), t*0.2), 3) - c)/e;
  return (dir*ga*0.7 + perp*gb*0.22)*0.25;
}
`
export const oceanFS = head + common + oceanUniforms + sampling('vnoise', 'uTime') + shoreLib('vnoise') + foamLib + `
uniform vec3 uCam;
uniform vec3 uDeep; uniform vec3 uShallow; uniform float uTurb; uniform float uClarity; uniform float uShoreFoam; uniform vec3 uFoamCol; uniform float uCollFoam;
varying vec2 vXZ; varying vec3 vW; varying float vH;
// 기울기(xy) + 야코비안 대각(zw) + 거품 — 텍스처 바밍 버전
vec4 derB(sampler2D t, sampler2D f, float L, float a, vec2 off, float seed, out float foam){
  float w = bombW(vXZ, L, seed), n = 1.0/sqrt(w*w + (1.0-w)*(1.0-w));
  vec2 u1 = cuv(vXZ, L, a, off), u2 = cuv(vXZ, L, a + 2.17, off + vec2(0.41, 0.27));
  vec4 A = texture2D(t, u1), B = texture2D(t, u2);
  foam = max(texture2D(f, u1).w*w, texture2D(f, u2).w*(1.0-w))*1.15;
  return vec4(rotS(A.xy, a)*w*n + rotS(B.xy, a + 2.17)*(1.0-w)*n, (A.zw*w + B.zw*(1.0-w))*n);
}
// 해저 커스틱 (절차적, 두 층을 회전/스케일 달리해 겹침)
float caustTile(vec2 uv, float t){
  vec2 p = mod(uv*6.28318, 6.28318) - 250.0; vec2 i = p; float c = 1.0;
  for (int n = 0; n < 4; n++){ float tt = t*(1.0 - 3.5/float(n+1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0/length(vec2(p.x/(sin(i.x + tt)/0.005), p.y/(cos(i.y + tt)/0.005))); }
  c /= 4.0; c = 1.17 - pow(c, 1.4); return pow(abs(c), 8.0);
}
float caustics(vec2 xz, float t){
  // 축 정렬 방지: 각 층 회전 + 저주파 도메인 워프
  vec2 w = xz + (vec2(vnoise(vec3(xz*0.09, t*0.05)), vnoise(vec3(xz*0.09 + 7.3, t*0.05))) - 0.5)*5.0;
  return caustTile(rotS(w, 0.47)/7.3, t*0.35)*0.6 + caustTile(rotS(w, 1.63)/4.1 + 0.3, t*0.45)*0.4;
}
// 절차적 디테일 노멀: 방향이 노이즈로 변하는 미세 리플 (FFT 타일과 무관한 비주기 성분)
vec2 detailSlope(vec2 xz, float t){
  float e = 0.08; vec2 p = xz*1.7 + vec2(t*0.35, t*0.21);
  float c = fbm(vec3(p, t*0.3), 2);
  return vec2(fbm(vec3(p + vec2(e, 0.0), t*0.3), 2) - c, fbm(vec3(p + vec2(0.0, e), t*0.3), 2) - c)/e*0.06;
}
void main(){
  uwInit(vW, uCam);
  vec3 toCam = uCam - vW; float dist = length(toCam); vec3 V = toCam/dist; float hd = length(toCam.xz);   // 디테일 컷오프는 수평 거리 기준
  float m = ampMod(vXZ);
  vec4 si = shoreInfo(vXZ); float wd0 = waterDepth(si.x);
  float att0 = 0.12 + 0.88*smoothstep(0.5, 18.0, wd0), att1 = smoothstep(0.4, 9.0, wd0);
  vec4 sw = swash(vXZ, si, uTime);
  vec2 uv0 = cuv(vXZ, uL.x, uRot.x, uOff01.xy);
  vec4 d0 = texture2D(uDer0, uv0); d0.xy = rotS(d0.xy, uRot.x);
  float f0 = texture2D(uDisp0, uv0).w, f1, f2;
  vec4 d1 = derB(uDer1, uDisp1, uL.y, uRot.y, uOff01.zw, 1.3, f1);
  vec4 d2 = derB(uDer2, uDisp2, uL.z, uRot.z, uOff2, 4.7, f2);
  float w0 = mix(1.0, m, 0.6)*att0, w1 = m*att1, w2 = m*att1*(1.0-smoothstep(800.0, 4000.0, dist));
  vec2 slope = d0.xy*w0 + d1.xy*w1 + d2.xy*w2 + (hd < uDetail ? detailSlope(vXZ, uTime) : vec2(0.0))*(0.35 + 0.65*att1)*(1.0-smoothstep(30.0, 250.0, dist));
  // 얕은 물: 해안 방향으로 늘어난 비주기 노이즈 디테일 + 해안 파도 기울기
  vec2 sdir = dot(si.zw, si.zw) > 0.0 ? normalize(si.zw) : vec2(1.0, 0.0);
  slope += (hd < uDetail ? shoreDetail(vXZ, sdir, uTime) : vec2(0.0))*(1.0 - att1)*(1.0-smoothstep(40.0, 300.0, dist));
  slope += -sdir*sw.y;
  float pk = peakMod(vXZ);
  float jm = min(d0.z, d0.w)*w0 + min(d1.z, d1.w)*w1;
  float sh = 1.0 + uSharp*1.2*pk; if (jm < 0.0) sh = min(sh, max(0.95/(-jm), 0.7));
  float jx = 1.0 + (d0.z*w0 + d1.z*w1)*sh + d2.z*w2, jz = 1.0 + (d0.w*w0 + d1.w*w1)*sh + d2.w*w2;
  float Jc = jx*jz;   // 전 캐스케이드 합성 야코비안 (수렴/접힘)
  float crest0 = clamp(vH/(uHs*0.5)*0.5+0.5, 0.0, 1.0);
  slope *= 1.0 + uSharp*pk*0.7*smoothstep(0.5, 0.95, crest0);   // 마루 노멀 강조
  slope /= vec2(max(jx, mix(0.25, 0.08, uSharp)), max(jz, mix(0.25, 0.08, uSharp)));
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  // 스펙큘러 안티에일리어싱: 노멀의 화면공간 변화량과 거리로 거칠기 확대 (Toksvig 근사) + 지역별 거칠기 변조
  vec3 dN = fwidth(N);
  float nv = clamp(dot(dN, dN)*2.0, 0.0, 0.5);
  float rough = clamp(sqrt(0.008 + 0.01*m + nv + dist*2e-6), 0.07, 0.6);
  float a2 = rough*rough*rough*rough;
  float NdV = clamp(dot(N, V), 0.001, 1.0);
  float F = 0.02 + 0.98*pow(1.0-NdV, 5.0);
  vec3 R = reflect(-V, N); R = normalize(vec3(R.x, max(abs(R.y), 0.01), R.z));
  vec3 refl = sky(R, 3, 0.0);
  vec3 sunC = uSunColor*uSunI;
  vec3 L = uSun; vec3 H = normalize(L + V);
  float NdH = max(dot(N, H), 0.0), NdL = max(dot(N, L), 0.0);
  float dd = NdH*NdH*(a2-1.0)+1.0; float D = a2/(3.14159*dd*dd);
  float FH = 0.02 + 0.98*pow(1.0-max(dot(H,V),0.0), 5.0);
  float k = rough*rough*0.5; float Gs = NdL/(NdL*(1.0-k)+k) * NdV/(NdV*(1.0-k)+k);
  vec3 spec = sunC*min(D*FH*Gs/(4.0*NdV + 1e-3), 60.0)*(1.0-uClouds*0.6);
  vec3 amb = uZenith*0.35 + uHorizon*0.15;
  vec3 light = sunC*max(uSun.y, 0.05)*0.6 + amb;

  // ---- Beer-Lambert 수중 광학 ----
  // 소광계수 σ = 흡수(얕은 물 색 = clarity 거리에서의 투과율) + 산란(탁도)
  float scat = 0.015 + 0.55*uTurb*uTurb;
  vec3 absorb = -log(clamp(uShallow, 0.02, 0.98))/uClarity*(1.0 + 1.5*uTurb);
  vec3 ext = absorb + scat;

  // 굴절 광선을 해저 평면(y=-depth)까지 추적
  vec3 T = refract(-V, N, 1.0/1.333);
  if (dot(T, T) < 1e-4) T = vec3(-V.x, -0.3, -V.z);
  // 해저 높이맵을 따라 굴절 광선 교차 (2회 보정)
  float depth = wd0;
  float path = (vW.y + depth)/max(-T.y, 0.04);
  vec3 bed = vW + T*path;
  for (int it = 0; it < 2; it++){ if (hd > uDetail) break; depth = waterDepth(shoreInfo(bed.xz).x); path = max(vW.y + depth, 0.0)/max(-T.y, 0.04); bed = vW + T*path; }
  float sand = 0.75 + 0.25*(hd < uDetail ? fbm(vec3(bed.xz*0.35, 3.0), 3) : 0.5);
  vec3 bedAlb = vec3(0.78, 0.7, 0.52)*sand;
  float cfade = 1.0 - smoothstep(0.0, 1.0, length(fwidth(bed.xz))*0.6);   // 멀면 커스틱을 평균값으로
  float ca = mix(0.12, (hd < uDetail ? caustics(bed.xz + T.xz*0.5, uTime) : 0.12), cfade)*(1.0 - uTurb*0.85)*(1.0 - uClouds*0.6);
  vec3 sunDown = sunC*max(uSun.y, 0.0)*exp(-ext*depth);
  vec3 bedCol = bedAlb*(sunDown*(0.55 + ca*3.0) + amb*exp(-ext*depth)*0.6);
  vec3 trans = exp(-ext*path);
  // 내부 산란: 탁할수록 우유빛, 맑으면 deep 색 쪽
  vec3 milky = mix(uShallow, vec3(0.62, 0.66, 0.58), 0.55);
  vec3 inscat = mix(uDeep, milky, clamp(uTurb*0.9 + 0.1, 0.0, 1.0)*(scat/(scat + dot(absorb, vec3(0.333)))))*light;
  float crest = clamp(vH/(uHs*0.5)*0.5+0.5, 0.0, 1.0);
  float back = pow(clamp(dot(V, normalize(vec3(-uSun.x,0.0,-uSun.z))),0.0,1.0), 4.0);
  inscat += uShallow*sunC*(crest*crest*0.12 + back*crest*0.25)*(1.0 - uTurb*0.5);
  vec3 water = bedCol*trans + inscat*(1.0 - trans);
  vec3 col = mix(water, refl, F) + spec;
  // 거품: FFT 화이트캡 + 해안선 띠 + 스워시 앞머리 + 잔류 거품, 비타일링 레이스 패턴으로 커버리지 결정
  // 외해 거품: 누적 화이트캡 + 합성 야코비안 수렴(물살 충돌) + 가파른 마루, 지역 노이즈로 변조
  float reg = mix(0.35, 1.0, smoothstep(0.35, 1.2, m))*(0.6 + 0.4*pk);
  float coll = smoothstep(0.8, 0.1, Jc);
  float steepF = smoothstep(0.3, 0.85, length(slope))*smoothstep(0.55, 0.92, crest0)*(0.3 + 0.7*pk);
  float foamA = clamp(clamp(f0*0.8 + f1*0.6 + f2*0.2, 0.0, 1.0)*(0.7 + 0.5*uCollFoam) + uCollFoam*(coll*0.7 + steepF*0.5), 0.0, 1.0)*reg*att1;
  float d = si.y;
  float band = smoothstep(-1.5, 0.5, d)*smoothstep(5.0, 0.5, d);
  float shoreMask = uShoreFoam*(band*0.75*step(0.0, d) + sw.z*0.9 + sw.w*0.55);
  float mask = clamp(foamA + shoreMask, 0.0, 1.0);
  float pat = mix(hd < uDetail ? lace(vXZ, uTime) : 0.55, 0.55, smoothstep(80.0, 600.0, dist));
  float foam = foamCover(mask, pat)*(1.0-smoothstep(1500.0, 6000.0, dist));
  vec3 foamC = uFoamCol*(amb*1.6 + sunC*0.55*max(N.y, 0.0));
  col = mix(col, foamC, foam*0.95);
  float fog = 1.0 - exp(-dist*0.000035);
  col = mix(col, sky(normalize(vec3(-V.x, 0.015, -V.z)), 0, 0.0), pow(fog, 1.4));
  // 물가: 수막 두께로 부드러운 알파
  float thick = vW.y - si.x;
  float alpha = smoothstep(0.0, 0.35, thick);
  if (uUnder > 0.001){
    // 수면을 아래에서 본 모습: 스넬의 창(굴절된 하늘) + 창 밖은 전반사(수중 색)
    vec3 Nd = -N; vec3 I = -V;
    vec3 Ta = refract(I, Nd, 1.333);
    vec3 rd = reflect(I, Nd); rd.y = min(rd.y, -0.02);
    vec3 below = uwMedium(normalize(rd));
    vec3 uc;
    if (dot(Ta, Ta) < 1e-4) uc = below;
    else {
      float c1 = abs(dot(V, N));
      float Fw = 0.02 + 0.98*pow(1.0 - c1, 5.0);
      Fw = max(Fw, smoothstep(0.76, 0.66, c1));     // 창 가장자리 부드럽게
      uc = mix(sky(normalize(Ta), 3, 1.0)*0.9 + foamC*foam*0.6, below, Fw);
    }
    uc = underFog(uc, dist, -V);
    col = mix(col, uc, uUnder); alpha = mix(alpha, 1.0, uUnder);
  }
  alpha = mix(alpha, 1.0, uMen);
  gl_FragColor = vec4(meniscus(col), alpha);
}`


// ---------- 섬 지형 (젖은 모래 띠 포함) ----------
export const islandFS = head + common + shoreLib('vnoise') + `
varying vec3 vCol; varying vec3 vN; varying vec3 vWp; uniform vec3 uCam; uniform float uBedOn;
void main(){
  // 해저 메시가 켜져 있으면 물속 부분은 해저(커스틱 포함)가 그림
  if (uBedOn > 0.5 && vWp.y < -0.4) discard;
  uwInit(vWp, uCam);
  vec3 n = normalize(vN); vec3 sunC = uSunColor*uSunI; vec3 amb = uZenith*0.5 + uHorizon*0.25;
  // 젖은 모래: 이번 파가 도달했던 곳은 물이 빠진 뒤 서서히 마름 + 이전 파들의 잔여 습기
  vec4 si = shoreInfo(vWp.xz); float x = -si.y;
  float wet = 0.0, foamL = 0.0;
  if (uShoreA > 0.0 && x > -2.0 && x < 40.0){
    vec4 ru = runup(vWp.xz, uTime); float s = ru.x, R = ru.y, F = ru.z, a = ru.w;
    float P = 6.28318/(sqrt(9.81*6.28318/uShoreLen)*0.75);
    float sd = x < R ? a + (1.0 - a)*acos(pow(clamp(x/R, 0.0, 1.0), 1.0/1.4))/1.5708 : 2.0;
    float cur = x < F ? 1.0 : (s > sd ? exp(-(s - sd)*P/5.0) : 0.0);
    wet = max(max(cur, 0.5*smoothstep(R*1.25 + 0.8, R*0.2, x)), 1.0 - smoothstep(-1.0, 0.5, x));
    // 최대 도달선에 남는 얇은 거품 줄 (빠지는 동안 사라짐)
    float edge = smoothstep(R - 0.9, R - 0.15, x)*smoothstep(R + 0.35, R, x);
    foamL = edge*(s > a ? exp(-(s - a)*P/3.0) : 0.0)*step(F, x)*smoothstep(0.35, 0.65, fbm(vec3(vWp.xz*1.7, uTime*0.1), 2));
  }
  vec3 alb = vCol*mix(1.0, 0.55, wet);
  vec3 V = normalize(uCam - vWp); vec3 H = normalize(uSun + V);
  vec3 col = alb*(sunC*max(dot(n, uSun), 0.0) + amb) + sunC*wet*0.25*pow(max(dot(n, H), 0.0), 60.0);
  col = mix(col, vec3(0.92, 0.95, 0.95)*(amb*1.6 + sunC*0.55), foamL*0.85);
  float dist = length(uCam - vWp);
  col = mix(col, sky(normalize(vec3(-V.x, 0.015, -V.z)), 0, 0.0), pow(1.0 - exp(-dist*0.000035), 1.4));
  if (uUnder > 0.001) col = mix(col, underFog(col*mix(1.0, 0.6, step(vWp.y, 0.0)), dist, -V), uUnder);
  gl_FragColor = vec4(meniscus(col), 1.0);
}`

// ---- 카메라 위치의 실제 수면 높이 (1x1 패스, 수평 변위 역보정 3회) ----
export const probeFS = head + oceanVSBody.replace('varying vec2 vXZ; varying vec3 vW; varying float vH;', 'vec2 vXZ; vec3 vW; float vH;') + `
uniform vec3 uNearL; uniform vec3 uNearR; uniform float uStripN; uniform vec2 uPts[64]; uniform float uNPts;
void main(){
  // 행 0: 근평면 가로선 위 점(카메라 기준 오프셋)의 실제 파고 스트립
  // 행 1: 텍셀 0 = 카메라 위치 파고, 텍셀 1.. = 부유체 샘플점 (R: 그 xz의 실제 파고, GB: 그 점을 정지 위치로 한 수평 변위)
  vec3 o; vec2 drift = vec2(0.0);
  if (gl_FragCoord.y < 1.0) o = mix(uNearL, uNearR, gl_FragCoord.x/uStripN);
  else {
    int i = int(gl_FragCoord.x);
    if (i == 0) o = vec3(0.0);
    else if (float(i) <= uNPts) { vec2 q = uPts[i - 1]; o = vec3(q.x, 0.0, q.y); drift = oceanDisplace(o).xz - (uOffset + q); }
    else { gl_FragColor = vec4(0.0); return; }
  }
  vec2 T = uOffset + o.xz;
  vec3 p = vec3(o.x, 0.0, o.z); vec3 w = vec3(0.0);
  for (int i = 0; i < 4; i++){ w = oceanDisplace(p); p.xz -= w.xz - T; }
  gl_FragColor = vec4(w.y, drift, 1.0);
}`

// ---------- 해저 (모래 바닥): 섬 지형 높이맵과 같은 해저면, 카메라 따라 이동하는 패치 ----------
export const seabedVS = `precision highp float;
uniform sampler2D uShore; uniform vec3 uShoreRect; uniform float uDepth; uniform vec2 uSnap;
varying vec2 vXZ; varying vec3 vW; varying float vH;
void main(){
  vec3 p = position + vec3(uSnap.x, 0.0, uSnap.y);
  vec2 uv = (p.xz - uShoreRect.xy)/uShoreRect.z;
  float h = -uDepth;
  if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) h = max(textureLod(uShore, uv, 0.0).r, -uDepth);
  p.y = min(h, 0.5) - 0.03;   // 얕은 물(-0.4m 위)은 섬 메시가 우선
  vW = p; vXZ = p.xz; vH = 0.0;
  gl_Position = projectionMatrix*viewMatrix*vec4(p, 1.0);
}`
export const seabedFS = oceanFS.slice(0, oceanFS.lastIndexOf('void main(){')) + `
uniform float uCaust;
void main(){
  uwInit(vW, uCam);
  vec3 toCam = uCam - vW; float dist = length(toCam); vec3 V = toCam/dist;
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); if (n.y < 0.0) n = -n;
  float depth = max(-vW.y, 0.0);
  float scat = 0.015 + 0.55*uTurb*uTurb;
  vec3 absorb = -log(clamp(uShallow, 0.02, 0.98))/uClarity*(1.0 + 1.5*uTurb);
  vec3 ext = absorb + scat;
  vec3 sunC = uSunColor*uSunI; vec3 amb = uZenith*0.35 + uHorizon*0.15;
  // 모래: 저주파 얼룩 + 물결 자국(사구 리플)
  float sand = 0.75 + 0.25*fbm(vec3(vW.xz*0.35, 3.0), 3);
  float rip = 0.5 + 0.5*sin(dot(vW.xz, vec2(1.9, 1.1)) + 3.0*vnoise(vec3(vW.xz*0.15, 1.0)));
  vec3 alb = vec3(0.78, 0.7, 0.52)*sand*(0.88 + 0.12*rip);
  float cfade = 1.0 - smoothstep(0.0, 1.0, length(fwidth(vW.xz))*0.6);
  float ca = mix(0.12, caustics(vW.xz, uTime), cfade)*(1.0 - uTurb*0.85)*(1.0 - uClouds*0.6)*uCaust;
  vec3 down = exp(-ext*depth);
  vec3 col = alb*(sunC*max(dot(n, uSun), 0.0)*down*(0.55 + ca*3.0) + amb*down*0.6);
  // 위에서 볼 때: 물기둥 투과/산란 (얕은 곳 바닥 비침), 수중일 때: 수중 안개
  vec3 tr = exp(-ext*depth/max(V.y, 0.1));
  vec3 above = col*tr + uDeep*(sunC*max(uSun.y, 0.05)*0.6 + amb)*(1.0 - tr);
  col = mix(above, underFog(col, dist, -V), uUnder);
  gl_FragColor = vec4(meniscus(col), 1.0);
}`