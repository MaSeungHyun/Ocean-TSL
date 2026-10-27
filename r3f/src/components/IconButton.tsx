import type { LucideIcon } from "lucide-react";
import { InfoTip } from "./InfoTip";

// 아이콘 버튼 (+ 선택적 정보 툴팁)
export function IconButton({
  icon: Icon,
  label,
  info,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  info?: string;
  onClick: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        aria-label={label}
        data-action={label}
        onClick={onClick}
        className="rounded-sm p-1 text-neutral-300 hover:bg-white/15 hover:text-white"
      >
        <Icon size={14} strokeWidth={2} />
      </button>
      {info && <InfoTip k={info} />}
    </span>
  );
}
