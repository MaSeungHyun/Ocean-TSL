import { Accordion, RangeRow } from "../../components";
import { useSettings } from "../../state/settingsStore";

export function WaveSection() {
  const params = useSettings((s) => s.params);
  const shore = useSettings((s) => s.shore);
  const { setParam, setShore } = useSettings.getState();
  return (
    <Accordion title="외해 파도 · 거품" info="sec.wave" open>
      <RangeRow
        label="풍속"
        info="wind"
        min={1}
        max={25}
        step={0.5}
        value={params.wind}
        unit=" m/s"
        onChange={(v) => setParam("wind", v)}
      />
      <RangeRow
        label="피크 파장"
        info="peak"
        min={8}
        max={200}
        step={1}
        value={params.peak}
        unit=" m"
        onChange={(v) => setParam("peak", v)}
      />
      <RangeRow
        label="초퍼니스"
        info="choppy"
        min={0}
        max={2}
        step={0.05}
        value={params.choppy}
        onChange={(v) => setParam("choppy", v)}
      />
      <RangeRow
        label="풍향"
        info="windDir"
        min={-3.14}
        max={3.14}
        step={0.01}
        value={params.windDir}
        onChange={(v) => setParam("windDir", v)}
      />
      <RangeRow
        label="파도 뾰족함"
        info="sharp"
        min={0}
        max={1}
        step={0.05}
        value={shore.sharp}
        onChange={(v) => setShore("sharp", v)}
      />
      <RangeRow
        label="물살 거품 양"
        info="collFoam"
        min={0}
        max={2}
        step={0.05}
        value={shore.collFoam}
        onChange={(v) => setShore("collFoam", v)}
      />
      <RangeRow
        label="거품 지속 시간"
        info="persist"
        min={0.3}
        max={4}
        step={0.1}
        value={shore.persist}
        unit="x"
        onChange={(v) => setShore("persist", v)}
      />
    </Accordion>
  );
}
