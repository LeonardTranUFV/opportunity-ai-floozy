"use client"

import { useEffect, useRef, useState } from "react"

/**
 * A number that counts up to its value the first time it is seen.
 *
 * The "5 a day" figure is the one measured claim on the page, and a number
 * that arrives rather than sits there gets read. It is the small reward for
 * having scrolled this far.
 *
 * Renders the final value immediately on the server and under reduced motion,
 * so the figure is never missing from a first paint or a thumbnail. The count
 * only ever starts *from* the real number's own resting state.
 */
export function CountUp({
  to,
  duration = 900,
  className = "",
}: {
  to: number
  duration?: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [value, setValue] = useState(to)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        const start = performance.now()
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration)
          // Ease-out: fast start, settles gently onto the final digit.
          const eased = 1 - Math.pow(1 - t, 3)
          setValue(Math.round(to * eased))
          if (t < 1) requestAnimationFrame(tick)
        }
        setValue(0)
        requestAnimationFrame(tick)
      },
      { threshold: 0.6 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [to, duration])

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {value}
    </span>
  )
}
