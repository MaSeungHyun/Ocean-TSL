import { InfoTip } from "./InfoTip";

// 라벨 + 값 표시 + range 슬라이더 (--p: 채움 비율, index.css)
export function RangeRow(p: {
  label: string;
  info?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="block">
      <div className="flex justify-between text-[11px] text-neutral-300">
        <span className="flex items-center gap-1">
          {p.label}
          {p.info && <InfoTip k={p.info} />}
        </span>
        <span className="tabular-nums text-neutral-100">
          {p.value.toFixed(p.step < 1 ? (p.step < 0.1 ? 2 : 1) : 0)}
          {p.unit}
        </span>
      </div>
      <input
        type="range"
        className="w-full"
        style={{
          ["--p" as string]: `${((p.value - p.min) / (p.max - p.min)) * 100}%`,
        }}
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        onChange={(e) => p.onChange(+e.target.value)}
      />
    </div>
  );
}
