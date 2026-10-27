import { useEffect } from "react";
import { shallow } from "zustand/shallow";
import { useSettings, type Settings } from "./settingsStore";

type Cleanup = void | (() => void);
// 리렌더 없이 스토어 값을 명령형으로 적용 (유니폼 등). 마운트 시 1회 + 선택값 변경 시 apply.
// apply가 함수를 반환하면 다음 apply 전/언마운트 시 호출 (디바운스 등)
export function useSettingsEffect<T>(
  sel: (s: Settings) => T,
  apply: (v: T) => Cleanup,
  deps: unknown[],
  equalityFn: (a: T, b: T) => boolean = shallow,
) {
  useEffect(() => {
    let c = apply(sel(useSettings.getState()));
    const un = useSettings.subscribe(
      sel,
      (v) => {
        if (c) c();
        c = apply(v);
      },
      { equalityFn },
    );
    return () => {
      un();
      if (c) c();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
