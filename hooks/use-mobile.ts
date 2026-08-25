import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * Subscribes to the viewport width rather than mirroring it into state from
 * an effect. The old version set state in the effect body purely to seed the
 * first value, which cost an extra render on every mount and is exactly the
 * pattern React now warns about — a media query is an external store, so it
 * can be read directly.
 *
 * Server-rendered output is the desktop layout; the browser corrects it on
 * the first read if the viewport is narrow.
 */
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  )
}
