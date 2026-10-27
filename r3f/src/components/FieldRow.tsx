import type { ReactNode } from "react";
import { InfoTip } from "./InfoTip";

// 라벨(+정보) ↔ 오른쪽 컨트롤 한 줄
export function FieldRow({
  label,
  info,
  children,
}: {
  label: string;
  info?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-300">
      <span className="flex items-center gap-1">
        {label}
        {info && <InfoTip k={info} />}
      </span>
      {children ?? <span />}
    </div>
  );
}
