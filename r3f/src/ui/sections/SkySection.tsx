import { Accordion, RangeRow } from "../../components";
import { useSettings } from "../../state/settingsStore";

export function SkySection() {
  const hour = useSettings((s) => s.params.hour);
  const clouds = useSettings((s) => s.params.clouds);
  const setParam = useSettings.getState().setParam;
  return (
    <Accordion title="하늘 · 시간" info="sec.sky">
      <RangeRow
        label="시간"
        info="hour"
        min={5.5}
        max={18.5}
        step={0.1}
        value={hour}
        unit=" 시"
        onChange={(v) => setParam("hour", v)}
      />
      <RangeRow
        label="구름 양"
        info="clouds"
        min={0}
        max={1}
        step={0.05}
        value={clouds}
        onChange={(v) => setParam("clouds", v)}
      />
    </Accordion>
  );
}
