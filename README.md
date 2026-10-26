# Ocean — FFT 바다 데모 (R3F · Babylon.js)

같은 셰이더(`shared/`)를 쓰는 두 가지 실시간 사실적 바다 데모입니다.

- **r3f/** — Vite + React + TypeScript + three.js + React Three Fiber + drei + Tailwind
- **babylon/** — Vite + TypeScript + Babylon.js

## 기능
- GPU FFT(Tessendorf) 3단 캐스케이드, JONSWAP 스펙트럼, 텍스처 바밍으로 반복 패턴 완화
- Beer-Lambert 흡수/산란, 해저 굴절 추적, 절차적 커스틱
- 해안 거리장(512²) 기반 수심 감쇠, 해안으로 밀려오는 파도(swash), Worley+fbm 물거품, 부드러운 물가·젖은 모래
- 시간대/구름 하늘, 섬

## 패널 조작
- 바다: 바람·파고·초퍼니스 등 / 시간·구름
- 물색: 프리셋(열대 맑은 물·먼바다·탁한 연안), 얕은/깊은 물 색, 탁도, 투명도, 수심
- 해안·거품: 해안 거품 양, 해안 파도 세기, 해안 파장, 거품 색, 거품 밝기

## 실행
```bash
cd r3f && npm install && npm run dev      # 또는 npm run build
cd babylon && npm install && npm run dev
```
