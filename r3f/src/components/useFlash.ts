import { useEffect, useRef, useState } from "react";

// 잠깐 보였다 사라지는 인라인 피드백 메시지
export function useFlash(ms = 1600) {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  const flash = (m: string) => {
    setMsg(m);
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(null), ms);
  };
  return [msg, flash] as const;
}
