"use client"

import { useEffect, useRef, type ReactNode } from "react"

/**
 * Reveal-from-depth for the marketing pages.
 *
 * Children start slightly *behind* the page — translated on the Z axis under
 * a perspective set on the section — and travel forward to rest as they enter
 * the viewport. That is the difference between something surfacing out of the
 * page and something fading in on top of it; the eye reads the first as
 * spatial and the second as a slideshow.
 *
 * Two rules the whole system obeys:
 *
 *   Readable at rest. The resting state is the fully visible one, and it is
 *   what the page shows with JavaScript off, in a thumbnail, and to anyone with
 *   reduced motion set. The observer only ever *removes* the offset; nothing
 *   is parked at opacity 0 waiting on a script.
 *
 *   One direction. A section that has revealed stays revealed. Re-hiding on
 *   scroll-up makes a page feel like it is being rebuilt under the reader.
 *
 * Marketing only. Nothing in the signed-in app imports this, on purpose.
 */
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className = "",
}: {
  children: ReactNode
  /** Stagger, in ms. Siblings step by ~70ms; more than ~400 reads as lag. */
  delay?: number
  as?: "div" | "section" | "li" | "article" | "p"
  className?: string
}) {
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Reduced motion: never take the resting state away in the first place.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    // No observer, no offset. The whole effect is optional; the content is not.
    if (typeof IntersectionObserver === "undefined") return

    el.classList.add("mk-reveal")
    const show = () => {
      el.classList.add("mk-in")
      io.disconnect()
      clearTimeout(failSafe)
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) show()
      },
      // Fire a little before the element is fully on screen, so the motion
      // is seen finishing rather than starting.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 }
    )
    io.observe(el)

    /**
     * Never leave content hidden waiting on an observer.
     *
     * Found by pointing a zero-size hidden browser frame at the page: the
     * observer can never intersect a viewport that has no area, so every
     * reveal stayed at opacity 0 and the hero was a blank field of colour.
     * The same happens in some in-app browsers and prerender contexts. The
     * motion is a nicety; the copy being on screen is the page. If nothing
     * has confirmed visibility within a beat of mounting, show it anyway.
     */
    const failSafe = window.setTimeout(show, 1400)

    return () => {
      io.disconnect()
      clearTimeout(failSafe)
    }
  }, [])

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref as any} className={className} style={{ transitionDelay: delay ? `${delay}ms` : undefined }}>
      {children}
    </Tag>
  )
}
