"use client"

import { useEffect, useRef } from "react"

/**
 * The layered background behind the hero.
 *
 * Three soft planes at three depths, each moving at its own rate as the page
 * scrolls — the far one barely, the near one noticeably. Parallax is the one
 * cue that makes a flat screen read as having depth, and it costs nothing
 * once the transforms are on the compositor.
 *
 * Scroll-driven, not time-driven: nothing moves unless the reader does, so
 * the page is perfectly still while being read. Reduced motion pins every
 * plane in place.
 */
export function DepthField() {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const planes = Array.from(root.querySelectorAll<HTMLElement>("[data-depth]"))
    let raf = 0
    const update = () => {
      raf = 0
      const y = window.scrollY
      for (const p of planes) {
        const depth = Number(p.dataset.depth ?? "0")
        // Far planes move less; the sign keeps them drifting up and away.
        p.style.transform = `translate3d(0, ${(-y * depth).toFixed(1)}px, 0)`
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div ref={ref} aria-hidden className="mk-depth" >
      <div data-depth="0.06" className="mk-plane mk-plane-far" />
      <div data-depth="0.14" className="mk-plane mk-plane-mid" />
      <div data-depth="0.26" className="mk-plane mk-plane-near" />
    </div>
  )
}
