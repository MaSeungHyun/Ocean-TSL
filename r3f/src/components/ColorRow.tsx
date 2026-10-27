import { FieldRow } from "./FieldRow";

export function ColorRow(p: {
  label: string;
  info?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <FieldRow label={p.label} info={p.info}>
      <input
        type="color"
        value={p.value}
        onChange={(e) => p.onChange(e.target.value)}
        className="h-6 w-10 bg-transparent"
      />
    </FieldRow>
  );
}
