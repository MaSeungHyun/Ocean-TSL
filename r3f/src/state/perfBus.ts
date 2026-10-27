// 프레임 통계 → PerfReadout (React 상태 없이 DOM 직접 갱신)
type Stat = { fps: string; dpr: string };
const stat: Stat = { fps: "--", dpr: "" };
const subs = new Set<(s: Stat) => void>();
export const perfBus = {
  get: () => stat,
  emit(p: Partial<Stat>) {
    Object.assign(stat, p);
    subs.forEach((f) => f(stat));
  },
  on(f: (s: Stat) => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};
