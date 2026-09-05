"use client"

import { useEffect, useLayoutEffect, useState } from "react"
import { createPortal } from "react-dom"
import { X, ArrowRight, ArrowLeft } from "lucide-react"
import { useTour, TOUR_STEPS } from "@/components/tour/tour-provider"
import { useHydrated } from "@/hooks/use-hydrated"

interface Box {
  top: number
  left: number
  width: number
  height: number
}

const PAD = 6
const CARD_W = 320
const GAP = 12

export function TourOverlay() {
  const { active, step, stepIndex, next, back, stop } = useTour()
  const [box, setBox] = useState<Box | null>(null)
  // createPortal needs document, so nothing renders until we are hydrated.
  const mounted = useHydrated()

  // Measure the target after paint so we get final layout, and keep it in sync
  // while the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!active || !step) return

    if (!step.target || step.center) {
      // Synchronous on purpose: a centred step has nothing to measure, and
      // deferring this to a frame would flash the previous step's cut-out
      // over the new card. The measuring path below still waits for layout.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBox(null)
      return
    }

    /**
      * The anchor that is actually on screen.
      *
      * Two navigations carry each anchor — the sidebar and the phone's bottom
      * bar — and only one of them is ever visible. querySelector returns the
      * first in document order, which is the sidebar: on a phone that lives in
      * a closed sheet and measures zero, so the tour would point at a
      * zero-size box in the corner. Size is the test, because it is the same
      * question the cut-out is about to ask.
      */
    const findVisible = (target: string): HTMLElement | null => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)
      )
      return candidates.find((el) => el.getBoundingClientRect().width > 0) ?? null
    }

    let raf = 0
    const measure = () => {
      const el = findVisible(step.target)
      if (!el) {
        // Target isn't on this page (collapsed sidebar, different route mid-
        // navigation). Fall back to a centred card rather than pointing at
        // nothing or silently stalling the tour.
        setBox(null)
        return
      }
      const r = el.getBoundingClientRect()
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height })
    }

    // One frame's delay lets route transitions settle before measuring.
    raf = requestAnimationFrame(() => {
      const el = findVisible(step.target)
      el?.scrollIntoView({ block: "center", behavior: "smooth" })
      measure()
    })

    window.addEventListener("scroll", measure, true)
    window.addEventListener("resize", measure)
    const poll = window.setInterval(measure, 400) // catches async layout shifts
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("scroll", measure, true)
      window.removeEventListener("resize", measure)
      clearInterval(poll)
    }
  }, [active, step])

  // Escape closes; arrows navigate.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop()
      if (e.key === "ArrowRight" || e.key === "Enter") next()
      if (e.key === "ArrowLeft") back()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active, next, back, stop])

  if (!mounted || !active || !step) return null

  const isLast = stepIndex === TOUR_STEPS.length - 1
  const centred = !box

  // Prefer below the target, flip above when there isn't room, and clamp
  // horizontally so the card never runs off a narrow screen.
  let cardStyle: React.CSSProperties
  if (centred) {
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: CARD_W }
  } else {
    const spaceBelow = window.innerHeight - (box.top + box.height)
    const placeBelow = spaceBelow > 220
    const top = placeBelow ? box.top + box.height + GAP : Math.max(GAP, box.top - 200 - GAP)
    const left = Math.min(
      Math.max(GAP, box.left + box.width / 2 - CARD_W / 2),
      Math.max(GAP, window.innerWidth - CARD_W - GAP)
    )
    cardStyle = { top, left, width: CARD_W, maxWidth: `calc(100vw - ${GAP * 2}px)` }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Spotlight. A single element with a huge spread box-shadow dims the
          whole page except its own rect — cheaper and sharper than compositing
          four separate mask panels, and it animates smoothly between steps. */}
      {box ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-brand transition-all duration-300"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(2, 6, 12, 0.72)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(2,6,12,0.72)]" />
      )}

      {/* Click-off-to-dismiss, behind the card. */}
      <button
        aria-label="Close tour"
        onClick={() => stop()}
        className="absolute inset-0 h-full w-full cursor-default"
        tabIndex={-1}
      />

      <div
        className="absolute flex flex-col gap-3 rounded-xl bg-popover p-4 text-popover-foreground shadow-xl ring-1 ring-foreground/10"
        style={cardStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="font-heading text-sm font-semibold">{step.title}</span>
          <button
            onClick={() => stop()}
            aria-label="Skip tour"
            className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-1" aria-hidden>
            {TOUR_STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === stepIndex ? "w-4 bg-brand" : "w-1.5 bg-muted"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {stepIndex > 0 && (
              <button
                onClick={back}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowLeft className="size-3" />
                Back
              </button>
            )}
            <button
              onClick={next}
              className="flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
            >
              {isLast ? "Finish" : "Next"}
              {!isLast && <ArrowRight className="size-3" />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
