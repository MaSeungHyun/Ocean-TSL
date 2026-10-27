import { Accordion, ColorRow, RangeRow } from "../../components";
import { useSettings } from "../../state/settingsStore";

export function ShoreSection() {
  const shore = useSettings((s) => s.shore);
  const setShore = useSettings.getState().setShore;
  return (
    <Accordion title="해안" info="sec.shore">
      <RangeRow
        label="해안 거품"
        info="shoreFoam"
        min={0}
        max={2}
        step={0.05}
        value={shore.shoreFoam}
        onChange={(v) => setShore("shoreFoam", v)}
      />
      <RangeRow
        label="해안 파도 세기"
        info="shoreWave"
        min={0}
        max={2}
        step={0.05}
        value={shore.shoreWave}
        unit=" m"
        onChange={(v) => setShore("shoreWave", v)}
      />
      <RangeRow
        label="해안 파장"
        info="shoreLen"
        min={6}
        max={40}
        step={1}
        value={shore.shoreLen}
        unit=" m"
        onChange={(v) => setShore("shoreLen", v)}
      />
      <ColorRow
        label="거품 색"
        info="foamColor"
        value={shore.foamColor}
        onChange={(v) => setShore("foamColor", v)}
      />
      <RangeRow
        label="거품 밝기"
        info="foamBright"
        min={0.3}
        max={2}
        step={0.05}
        value={shore.foamBright}
        onChange={(v) => setShore("foamBright", v)}
      />
    </Accordion>
  );
}
