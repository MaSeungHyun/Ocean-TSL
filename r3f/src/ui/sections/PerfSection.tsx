import {
  Accordion,
  Button,
  InfoTip,
  RangeRow,
  SelectRow,
  ToggleRow,
} from "../../components";
import { useSettings, type Quality } from "../../state/settingsStore";
import type { UpdateMode } from "../../fft";

const QUALITY_OPTS = [
  ["low", "낮음"],
  ["medium", "보통"],
  ["high", "높음"],
] as const satisfies readonly (readonly [Quality, string])[];
const FFT_OPTS = [
  [128, "128"],
  [256, "256"],
  [512, "512"],
] as const satisfies readonly (readonly [number, string])[];
const MODE_OPTS = [
  ["every", "매 프레임"],
  ["alt", "교대"],
  ["nth", "N프레임마다"],
] as const satisfies readonly (readonly [UpdateMode, string])[];
const FFT_ROWS = [
  ["FFT 해상도 · 원거리", "fft0"],
  ["FFT 해상도 · 중간", "fft1"],
  ["FFT 해상도 · 근거리", "fft2"],
] as const;

export function PerfSection() {
  const quality = useSettings((s) => s.quality);
  const perf = useSettings((s) => s.perf);
  const dpr = useSettings((s) => s.dpr);
  const { setQuality, setFftN, setPerf, setDpr, setDyn, resetPerf } =
    useSettings.getState();
  return (
    <Accordion title="성능" info="sec.perf">
      <SelectRow<Quality>
        label="품질 프리셋"
        info="quality"
        value={quality}
        options={QUALITY_OPTS}
        onChange={setQuality}
      />
      {FFT_ROWS.map(([label, info], i) => (
        <SelectRow<number>
          key={info}
          label={label}
          info={info}
          value={perf.n[i]}
          options={FFT_OPTS}
          onChange={(v) => setFftN(i as 0 | 1 | 2, v)}
        />
      ))}
      <SelectRow<UpdateMode>
        label="캐스케이드 갱신"
        info="mode"
        value={perf.mode}
        options={MODE_OPTS}
        onChange={(v) => setPerf("mode", v)}
      />
      {perf.mode === "nth" && (
        <RangeRow
          label="N"
          info="nth"
          min={2}
          max={6}
          step={1}
          value={perf.nth}
          unit=" 프레임"
          onChange={(v) => setPerf("nth", v)}
        />
      )}
      <RangeRow
        label="디테일 거리"
        info="detail"
        min={50}
        max={3000}
        step={10}
        value={perf.detail}
        unit=" m"
        onChange={(v) => setPerf("detail", v)}
      />
      <RangeRow
        label="픽셀 비율"
        info="dpr"
        min={0.5}
        max={2}
        step={0.25}
        value={dpr}
        onChange={setDpr}
      />
      <RangeRow
        label="DPR 상한"
        info="dprCap"
        min={0.5}
        max={2}
        step={0.25}
        value={perf.dprCap}
        onChange={(v) => setPerf("dprCap", v)}
      />
      <ToggleRow
        label="동적 해상도"
        info="dyn"
        checked={perf.dyn}
        onChange={setDyn}
      />
      {perf.dyn && (
        <RangeRow
          label="목표 FPS"
          info="target"
          min={30}
          max={120}
          step={5}
          value={perf.target}
          onChange={(v) => setPerf("target", v)}
        />
      )}
      <RangeRow
        label="파고 읽기 간격 (큐브 있음)"
        info="probeCube"
        min={1}
        max={12}
        step={1}
        value={perf.probeCube}
        unit=" 프레임"
        onChange={(v) => setPerf("probeCube", v)}
      />
      <RangeRow
        label="파고 읽기 간격 (큐브 없음)"
        info="probeIdle"
        min={1}
        max={30}
        step={1}
        value={perf.probeIdle}
        unit=" 프레임"
        onChange={(v) => setPerf("probeIdle", v)}
      />
      <div className="flex items-center gap-1.5">
        <Button onClick={resetPerf}>초기화</Button>
        <InfoTip k="perfReset" />
      </div>
    </Accordion>
  );
}
