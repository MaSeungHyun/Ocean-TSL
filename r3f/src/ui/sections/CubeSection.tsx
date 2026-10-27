import {
  Accordion,
  Button,
  FieldRow,
  RangeRow,
  ToggleRow,
} from "../../components";
import { useSettings } from "../../state/settingsStore";

export function CubeSection() {
  const cube = useSettings((s) => s.cube);
  const { setCube, addCube, resetCubes } = useSettings.getState();
  return (
    <Accordion title="부유 큐브 · 해저" info="sec.cube">
      <FieldRow label="큐브" info="cubeAdd">
        <span className="text-neutral-400">{Math.min(cube.add, 10)}개</span>
      </FieldRow>
      <div className="flex gap-1">
        <Button onClick={addCube}>큐브 추가</Button>
        <Button onClick={resetCubes}>초기화</Button>
      </div>
      <RangeRow
        label="큐브 크기"
        info="cubeSize"
        min={0.3}
        max={4}
        step={0.1}
        value={cube.size}
        unit=" m"
        onChange={(v) => setCube("size", v)}
      />
      <RangeRow
        label="밀도(흘수)"
        info="cubeDensity"
        min={0.1}
        max={0.95}
        step={0.05}
        value={cube.density}
        onChange={(v) => setCube("density", v)}
      />
      <ToggleRow
        label="해저 커스틱"
        info="caustics"
        checked={cube.caustics}
        onChange={(v) => setCube("caustics", v)}
      />
    </Accordion>
  );
}
