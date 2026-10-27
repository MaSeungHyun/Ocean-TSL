import { Accordion, Button } from "../../components";
import { goCam, type CamKey } from "../../scene/CameraRig";

const VIEWS: [CamKey, string][] = [
  ["low", "수면"],
  ["high", "상공"],
  ["shore", "해안"],
  ["top", "위에서"],
  ["waterline", "수면선(반반)"],
  ["under", "수중"],
  ["underUp", "수중→위"],
  ["floor", "해저"],
];

export function CameraSection() {
  return (
    <Accordion title="카메라" info="sec.cam">
      <div className="grid grid-cols-2 gap-1">
        {VIEWS.map(([k, l]) => (
          <Button key={k} onClick={() => goCam(k)}>
            {l}
          </Button>
        ))}
      </div>
    </Accordion>
  );
}
