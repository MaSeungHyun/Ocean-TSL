import { Accordion, ColorRow, RangeRow } from "../../components";
import { useSettings } from "../../state/settingsStore";

export function UnderSection() {
  const under = useSettings((s) => s.under);
  const setUnder = useSettings.getState().setUnder;
  return (
    <Accordion title="수중" info="sec.under">
      <ColorRow
        label="수중 색"
        info="uwColor"
        value={under.color}
        onChange={(v) => setUnder("color", v)}
      />
      <RangeRow
        label="수중 밀도"
        info="uwDensity"
        min={0.01}
        max={0.4}
        step={0.01}
        value={under.density}
        unit=" /m"
        onChange={(v) => setUnder("density", v)}
      />
    </Accordion>
  );
}
