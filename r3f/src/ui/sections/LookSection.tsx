import {
  Accordion,
  Button,
  ColorRow,
  FieldRow,
  RangeRow,
} from "../../components";
import { WATER_PRESETS } from "../../spectrum";
import { useSettings } from "../../state/settingsStore";

export function LookSection() {
  const look = useSettings((s) => s.look);
  const { setLook, applyLook } = useSettings.getState();
  return (
    <Accordion title="물빛 · 탁도" info="sec.look">
      <FieldRow label="프리셋" info="preset" />
      <div className="flex gap-1">
        {Object.entries(WATER_PRESETS).map(([k, v]) => (
          <Button key={k} onClick={() => applyLook(v)}>
            {k}
          </Button>
        ))}
      </div>
      <ColorRow
        label="깊은 물 색"
        info="deep"
        value={look.deep}
        onChange={(v) => setLook("deep", v)}
      />
      <ColorRow
        label="얕은 물 색"
        info="shallow"
        value={look.shallow}
        onChange={(v) => setLook("shallow", v)}
      />
      <RangeRow
        label="탁도"
        info="turbidity"
        min={0}
        max={1}
        step={0.01}
        value={look.turbidity}
        onChange={(v) => setLook("turbidity", v)}
      />
      <RangeRow
        label="투명 거리"
        info="clarity"
        min={2}
        max={60}
        step={1}
        value={look.clarity}
        unit=" m"
        onChange={(v) => setLook("clarity", v)}
      />
      <RangeRow
        label="해저 깊이"
        info="depth"
        min={3}
        max={40}
        step={0.5}
        value={look.depth}
        unit=" m"
        onChange={(v) => setLook("depth", v)}
      />
    </Accordion>
  );
}
