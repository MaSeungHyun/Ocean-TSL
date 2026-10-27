import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { InfoTip } from "./InfoTip";

// 접이식 섹션: 타이틀 바(밝은 톤) / 콘텐츠(어두운 톤) 구분
export function Accordion({
  title,
  info,
  open: o = false,
  children,
}: {
  title: string;
  info?: string;
  open?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(o);
  return (
    <div className="mb-1.5 overflow-hidden rounded-md border border-white/10 last:mb-0">
      <div
        className={`flex items-center gap-1.5 bg-neutral-700/70 px-2.5 py-2 hover:bg-neutral-700 ${open ? "border-b border-white/15" : ""}`}
      >
        <button
          onClick={() => setOpen(!open)}
          className="flex flex-1 items-center gap-1.5 text-left text-[12px] font-bold text-white"
        >
          <ChevronRight
            size={14}
            className={`shrink-0 text-neutral-300 transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span>{title}</span>
        </button>
        {info && <InfoTip k={info} />}
      </div>
      {open && (
        <div className="space-y-2 bg-neutral-950/60 px-2.5 py-2.5">
          {children}
        </div>
      )}
    </div>
  );
}
