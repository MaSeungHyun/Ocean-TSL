// 개발용 렌더 카운터: window.__renders[name] (빌드에서는 no-op)
export function countRender(name: string) {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __renders?: Record<string, number> };
  const r = (w.__renders ??= {});
  r[name] = (r[name] ?? 0) + 1;
}
