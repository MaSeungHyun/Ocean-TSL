import { Copy } from "lucide-react";
import { Button, IconButton, copyText, useFlash } from "../components";
import { exportSettings } from "../state/settingsIO";

// 패널 헤더: 현재 설정을 JSON으로 클립보드에 복사
export function SettingsIO() {
  const [msg, flash] = useFlash();
  const onCopy = async () => {
    const ok = await copyText(JSON.stringify(exportSettings(), null, 2));
    flash(ok ? "복사됨" : "복사 실패");
  };
  return (
    <span className="flex items-center gap-1">
      {msg && (
        <span role="status" className="text-[11px] font-normal text-sky-300">
          {msg}
        </span>
      )}
      <Button onClick={onCopy}>Export</Button>
    </span>
  );
}
