import { countRender } from "../dev/renderCount";
import { SettingsIO } from "./SettingsIO";
import { WaveSection } from "./sections/WaveSection";
import { SkySection } from "./sections/SkySection";
import { LookSection } from "./sections/LookSection";
import { ShoreSection } from "./sections/ShoreSection";
import { UnderSection } from "./sections/UnderSection";
import { CubeSection } from "./sections/CubeSection";
import { PerfSection } from "./sections/PerfSection";
import { CameraSection } from "./sections/CameraSection";

// 설정 패널 셸: 상태를 구독하지 않음 (각 섹션이 자기 슬라이스만 구독)
export function Panel() {
  countRender("panel");
  return (
    <div className="absolute right-3 top-3 w-72 max-h-[calc(100vh-24px)] overflow-y-auto rounded-sm bg-neutral-900/85 px-3 py-1 text-white">
      <div className="flex items-center justify-between py-2 text-sm font-semibold text-neutral-100">
        <span>바다 설정</span>
        <SettingsIO />
      </div>
      <WaveSection />
      <SkySection />
      <LookSection />
      <ShoreSection />
      <UnderSection />
      <CubeSection />
      <PerfSection />
      <CameraSection />
    </div>
  );
}
