"use client"

import { useRef, type ReactNode } from "react"

/**
 * A card that tilts toward the pointer, and toward a touch.
 *
 * The single most legible "this is a 3D object" cue is a surface that turns
 * to face you. Hover on a desktop, and the same gesture from a finger on a
 * phone — a touch is a pointer event too, so one handler serves both, and the
 * card settles back when the finger lifts.
 *
 * The tilt is small on purpose (±7°). Bigger reads as a gimmick, and the
 * point is that the card feels like a physical thing, not that it performs.
 *
 * Reduced motion: no listener is attached at all; the card is simply a card.
 */
export function TiltCard({
  children,
  className = "",
  max = 7,
}: {
  children: ReactNode
  className?: string
  /** Maximum tilt in degrees. */
  max?: number
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const raf = useRef(0)

  const reduced = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || reduced()) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty("--tilt-x", `${(-py * max).toFixed(2)}deg`)
      el.style.setProperty("--tilt-y", `${(px * max).toFixed(2)}deg`)
      // The highlight follows the pointer across the surface.
      el.style.setProperty("--glare-x", `${((px + 0.5) * 100).toFixed(1)}%`)
      el.style.setProperty("--glare-y", `${((py + 0.5) * 100).toFixed(1)}%`)
    })
  }

  const onLeave = () => {
    const el = ref.current
    if (!el) return
    cancelAnimationFrame(raf.current)
    el.style.setProperty("--tilt-x", "0deg")
    el.style.setProperty("--tilt-y", "0deg")
  }

  return (
    <div
      ref={ref}
      className={`mk-tilt ${className}`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onPointerUp={onLeave}
      onPointerCancel={onLeave}
    >
      {children}
    </div>
  )
}
