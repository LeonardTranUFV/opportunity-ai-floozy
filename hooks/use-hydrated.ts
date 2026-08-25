import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False while rendering on the server and through the first client render,
 * true afterwards. For UI that genuinely cannot render until it is in a
 * browser — a theme icon that depends on the resolved theme, a portal that
 * needs `document` — and would otherwise mismatch during hydration.
 *
 * `useSyncExternalStore` rather than the usual `useEffect(() => setMounted(true))`:
 * the two produce the same answer, but the effect version schedules an extra
 * render pass on every mount and React now flags it, since an effect that
 * only calls setState is not synchronising with anything external.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
