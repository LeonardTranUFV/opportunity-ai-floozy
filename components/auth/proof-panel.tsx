"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

/**
 * The rotating half of the auth screens.
 *
 * It cycles trades rather than layouts, and that is the whole point. The first
 * question a contractor asks on a landing page is "does this work for what *I*
 * do", and a panel showing three roofing jobs quietly answers no to every
 * painter who sees it. Rotating the trade answers it for all of them without a
 * word of copy about breadth.
 *
 * Rules this follows, each for a reason that has bitten someone before:
 *
 *   - Every scene renders in the same grid cell, all but one at opacity 0, so
 *     the panel never resizes as content changes and the form beside it never
 *     shifts under a cursor.
 *   - Auto-advancing content stops entirely under `prefers-reduced-motion`.
 *     Motion that a reader cannot pause is a genuine accessibility problem,
 *     not a preference, so that case gets a single static scene.
 *   - The timer stops when the tab is hidden. A sign-in page left open in a
 *     background tab should not be repainting all afternoon.
 *   - Hidden scenes are `aria-hidden` and the live one is a polite live region,
 *     so a screen reader reads one set of examples rather than twelve.
 *
 * These are representative examples, never live rows: this renders before
 * anyone has authenticated, and a signed-out visitor must never be shown a
 * real customer's leads.
 */

const ROTATE_MS = 7000

interface Lead {
  post: string
  where: string
  platform: string
  age: string
  score: number
}

interface Scene {
  trade: string
  leads: Lead[]
}

/**
 * Deliberately ordinary jobs. A $40k renovation reads as marketing; a leaking
 * roof and a laminate floor read as a normal week, which is the claim we are
 * actually making.
 */
const SCENES: Scene[] = [
  {
    trade: "Roofing",
    leads: [
      {
        post: "Anyone know a good roofer? Ours started leaking after the storm last night and there's water coming through the ceiling.",
        where: "Burnaby, BC",
        platform: "Nextdoor",
        age: "2h ago",
        score: 94,
      },
      {
        post: "Need someone to look at flashing around a chimney before the rain sets in. Small job.",
        where: "New Westminster, BC",
        platform: "Facebook",
        age: "6h ago",
        score: 88,
      },
      {
        post: "Getting quotes to re-shingle a bungalow. Who has people used and been happy with?",
        where: "Langley, BC",
        platform: "Facebook",
        age: "11h ago",
        score: 85,
      },
    ],
  },
  {
    trade: "Painting & flooring",
    leads: [
      {
        post: "Looking for someone to install laminate flooring in two bedrooms. Materials already bought, just need it laid properly.",
        where: "Coquitlam, BC",
        platform: "Facebook",
        age: "5h ago",
        score: 91,
      },
      {
        post: "Need a painter for the interior of a 3-bed. Would like it done before we move in end of the month.",
        where: "Surrey, BC",
        platform: "Facebook",
        age: "9h ago",
        score: 87,
      },
      {
        post: "Any recommendations for someone to do baseboards and trim? Previous guy stopped replying.",
        where: "Richmond, BC",
        platform: "Nextdoor",
        age: "1d ago",
        score: 80,
      },
    ],
  },
  {
    trade: "Electrical & plumbing",
    leads: [
      {
        post: "Half the kitchen outlets died this morning. Need an electrician who can come out today if possible.",
        where: "Vancouver, BC",
        platform: "Nextdoor",
        age: "1h ago",
        score: 96,
      },
      {
        post: "Hot water tank is leaking at the base. Looking for a plumber for a replacement, not a patch.",
        where: "Burnaby, BC",
        platform: "Facebook",
        age: "4h ago",
        score: 92,
      },
      {
        post: "Want to add a 240v line to the garage for a car charger. Who's licensed and reasonable?",
        where: "Port Coquitlam, BC",
        platform: "Facebook",
        age: "8h ago",
        score: 84,
      },
    ],
  },
]

function LeadCard({ lead }: { lead: Lead }) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {lead.platform} · {lead.where}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-brand">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden />
          {lead.score}
        </span>
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-foreground">&ldquo;{lead.post}&rdquo;</p>
      <p className="mt-3 text-xs text-muted-foreground">{lead.age}</p>
    </article>
  )
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

/**
 * Subscribes to the OS motion setting.
 *
 * `useSyncExternalStore` rather than an effect that calls setState: the
 * preference is external state that can change while the page is open, and
 * reading it into state from inside an effect causes a cascading render on
 * every mount for no benefit. The server snapshot assumes motion is allowed,
 * which is the safe default — a reader who wants less motion gets it on the
 * first client render, before the timer below is ever created.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION)
      query.addEventListener("change", onChange)
      return () => query.removeEventListener("change", onChange)
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false
  )
}

export function ProofPanel() {
  const [index, setIndex] = useState(0)
  const reduced = usePrefersReducedMotion()
  const rotating = !reduced

  useEffect(() => {
    if (!rotating) return

    let timer: ReturnType<typeof setInterval> | undefined

    const start = () => {
      timer ??= setInterval(() => setIndex((i) => (i + 1) % SCENES.length), ROTATE_MS)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = undefined
    }
    const onVisibility = () => (document.hidden ? stop() : start())

    start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [rotating])

  return (
    <div className="relative hidden overflow-hidden border-r border-border bg-accent/30 lg:flex lg:flex-col lg:justify-center lg:px-14 lg:py-16">
      <div
        className="pointer-events-none absolute -left-32 top-1/4 size-[34rem] rounded-full bg-brand/10 blur-3xl"
        aria-hidden
      />

      <div className="relative">
        <p className="font-[family-name:var(--font-archivo)] text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Found this week · {SCENES[index].trade}
        </p>
        <h2 className="mt-4 max-w-md text-balance font-[family-name:var(--font-archivo)] text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
          People asking for your trade, before anyone sold them to you.
        </h2>

        {/* Every scene occupies the same grid cell so the panel keeps one
            height. Stacking rather than swapping is what stops the form
            beside it jumping mid-rotation. */}
        <div className="mt-10 grid max-w-md">
          {SCENES.map((scene, i) => (
            <div
              key={scene.trade}
              aria-hidden={i !== index}
              className={`col-start-1 row-start-1 flex flex-col gap-3 transition-opacity duration-700 motion-reduce:transition-none ${
                i === index ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              {scene.leads.map((lead) => (
                <LeadCard key={lead.post} lead={lead} />
              ))}
            </div>
          ))}
        </div>

        <p className="mt-8 max-w-md text-sm text-muted-foreground" aria-live="polite">
          {rotating ? "Examples across trades" : "Examples of what the agent surfaces"}. Angi and
          HomeStars sell the same lead to three or four contractors at once — these go to one.
        </p>

        {rotating ? (
          <div className="mt-5 flex gap-1.5" aria-hidden>
            {SCENES.map((scene, i) => (
              <span
                key={scene.trade}
                className={`h-1 rounded-full transition-all duration-500 ${
                  i === index ? "w-6 bg-brand" : "w-1.5 bg-border"
                }`}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
