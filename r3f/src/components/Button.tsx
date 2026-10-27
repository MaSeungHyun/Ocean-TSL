import type { ButtonHTMLAttributes } from "react";

export function Button({
  className = "",
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={`flex-1 rounded-sm bg-white/10 px-2 py-1 text-[11px] text-neutral-200 hover:bg-white/20 ${className}`.trim()}
    />
  );
}
