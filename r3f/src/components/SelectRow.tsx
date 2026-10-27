import { FieldRow } from "./FieldRow";

// 세그먼트 선택 (라벨이 있으면 위 줄에 표시)
export function SelectRow<T extends string | number>({
  label,
  info,
  value,
  options,
  onChange,
}: {
  label?: string;
  info?: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <>
      {label && <FieldRow label={label} info={info} />}
      <div className="flex gap-1 text-[11px]">
        {options.map(([v, l]) => (
          <button
            key={String(v)}
            onClick={() => onChange(v)}
            className={`flex-1 rounded-sm px-1.5 py-1 ${value === v ? "bg-neutral-200 text-neutral-900" : "bg-white/10 text-neutral-200 hover:bg-white/20"}`}
          >
            {l}
          </button>
        ))}
      </div>
    </>
  );
}
