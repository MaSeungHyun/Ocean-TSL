# Ocean · R3F + GPU FFT

Three.js WebGLRenderer(WebGL2, GLSL ShaderMaterial) + React Three Fiber + drei + Tailwind v4로 만든 실사풍 바다예요.

```bash
npm install
npm run dev       # 개발 서버 (http://localhost:5173)
npm run build     # 타입 검사 + 프로덕션 빌드
npm run preview   # 빌드 결과 미리보기 (http://localhost:4173)
```

URL 옵션: `?cam=low|high`, `?q=low|medium|high`, `?dpr=1`, `?wind=12`, `?peak=80`, `?hour=18`, `?clouds=0.6`

## 기법 (GPU FFT 바다)
- **Tessendorf FFT**: CPU에서 JONSWAP 스펙트럼(γ=3.3, 피크 파장→취송거리 환산)과 주파수별 cos^2s(θ/2) 방향 분산으로 초기 h0(k)를 만들어요(파라미터 바꿀 때만 재계산). 매 프레임 GPU에서 시간 진화 후 Stockham radix-2 역 FFT(가로→세로, RGBA32F 핑퐁)를 돌려요.
- **3 캐스케이드**: 패치 크기 251.3m / 37.7m / 5.71m(서로 나누어 떨어지지 않음). 스펙트럼 대역을 k 경계로 잘라 겹치지 않게 했어요.
- **출력**: 변위(x·y·z, choppiness 포함), 기울기와 야코비안 미분(노멀용), 야코비안 기반 거품(이전 프레임 값을 지수 감쇠하며 누적). RGBA16F, 선형+밉맵, 반복 래핑, 이방성 필터링(최대 16x).
- **반복 패턴 제거**: 캐스케이드마다 회전과 UV 오프셋을 다르게 주고, 수백 m 스케일 저주파 노이즈로 진폭과 거품을 변조해요. 거리에 따라 작은 캐스케이드를 페이드하고, 정점 샘플은 그리드 간격에 맞춘 밉 레벨(textureLod)로 걸러요.
- **안티에일리어싱**: 노멀은 픽셀마다 미분 텍스처에서 계산해요. GGX 스펙큘러의 거칠기는 fwidth(N)와 거리로 키우는 방식(Toksvig 근사)이고, 반사 하늘에는 태양 원반을 넣지 않아 글린트가 부드러워요. MSAA를 켜고, 기본 픽셀 비율은 min(devicePixelRatio, 2)예요.
- **그리드**: 카메라 중심 방사형 그리드(high는 링 900개, 약 46만 정점).
- **품질 프리셋**: low/medium은 FFT 256², high는 512².
- 셰이더는 `src/glsl.ts`, 스펙트럼은 `src/spectrum.ts`에 있고 두 프로젝트가 같은 코드를 써요. GPU 패스는 `src/fft.ts`에 있어요.

## 한계
- 컴퓨트 셰이더 대신 프래그먼트 패스로 FFT를 돌려요(WebGL2 호환). high 품질에서는 프레임당 약 120패스예요.
- 스펙트럼 재계산(512²×3)은 CPU에서 약 0.2초 걸려서, 슬라이더를 움직일 때 살짝 끊길 수 있어요.
- 해안 상호작용(굴절, 쇄파)은 진폭 감쇠와 얕은 물 색으로만 근사했어요.

## 추가 조작 (물색 · 해안)
- 물색 프리셋, 얕은/깊은 물 색, 탁도(Turbidity), 투명도(Clarity), 수심
- 해안 거품 양, 해안 파도 세기(m), 해안 파장(m), 거품 색, 거품 밝기
