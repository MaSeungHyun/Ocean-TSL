import { FieldRow } from "./FieldRow";

export function ToggleRow(p: {
  label: string;
  info?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <FieldRow label={p.label} info={p.info}>
      <input
        type="checkbox"
        checked={p.checked}
        onChange={(e) => p.onChange(e.target.checked)}
      />
    </FieldRow>
  );
}
