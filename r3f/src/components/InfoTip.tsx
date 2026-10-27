import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info as InfoIcon } from "lucide-react";
import { INFO } from "../settingInfo";

// 정보 아이콘 + 포털 툴팁 (뷰포트 안으로 flip/shift, 잘림 없음). k: settingInfo 키
export function InfoTip({ k }: { k: string }) {
  const ref = useRef<HTMLSpanElement>(null),
    tip = useRef<HTMLDivElement>(null);
  const [r, setR] = useState<DOMRect | null>(null),
    [pos, setPos] = useState({ x: -9999, y: -9999 });
  useLayoutEffect(() => {
    if (!r || !tip.current) return;
    const t = tip.current.getBoundingClientRect(),
      m = 8,
      W = window.innerWidth,
      H = window.innerHeight;
    let x = r.left - t.width - m; // 기본: 왼쪽 (패널이 화면 오른쪽)
    if (x < m) x = r.right + m; // flip
    x = Math.min(Math.max(m, x), W - m - t.width); // shift
    let y = r.top + r.height / 2 - t.height / 2;
    y = Math.min(Math.max(m, y), H - m - t.height);
    setPos({ x, y });
  }, [r]);
  const text = INFO[k];
  if (!text) return null;
  const show = () => ref.current && setR(ref.current.getBoundingClientRect());
  const hide = () => {
    setR(null);
    setPos({ x: -9999, y: -9999 });
  };
  return (
    <span
      ref={ref}
      data-info={k}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="inline-flex shrink-0 cursor-help text-neutral-500 outline-none hover:text-neutral-100"
    >
      <InfoIcon size={12} strokeWidth={2} />
      {r &&
        createPortal(
          <div
            ref={tip}
            role="tooltip"
            style={{ left: pos.x, top: pos.y }}
            className="pointer-events-none fixed z-[10000] w-max max-w-[260px] whitespace-normal break-keep rounded bg-neutral-800 px-2.5 py-2 text-[11px] leading-snug text-neutral-100 ring-1 ring-white/15"
          >
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
