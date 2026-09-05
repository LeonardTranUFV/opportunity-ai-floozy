"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

export interface TourStep {
  /** Matches a `data-tour="..."` attribute on the element to highlight. */
  target: string
  title: string
  body: string
  /** Route this step lives on — the tour navigates there if needed. */
  route: string
  /** Show the step centred with no spotlight (used for intro/outro). */
  center?: boolean
}

/**
 * The walkthrough itself. Ordered as the work actually happens, because the
 * pipeline is strictly sequential — you can't scan before there's a source to
 * scan, and a lead can't exist before an agent scores it.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    target: "",
    route: "/",
    center: true,
    title: "Let's set this up together",
    body: "Four steps, about two minutes. I'll point at each button as we go — you can stop any time and pick up where you left off.",
  },
  {
    target: "nav-accounts",
    route: "/",
    title: "1 — Connect an account",
    body: "Start here. A browser opens inside the page and you sign into Facebook, LinkedIn, Nextdoor or X yourself. We never see your password, and the sign-in is saved so you only do it once.",
  },
  {
    target: "nav-communities",
    route: "/",
    title: "2 — Choose where to watch",
    body: "Next, tell it which groups, neighbourhoods or searches to monitor. Not sure which? There's a button on that page that suggests 10–12 worth joining for your trade and city.",
  },
  {
    target: "nav-agents",
    route: "/",
    title: "3 — Create an AI agent",
    body: "An agent is just a description of what you're hunting for, in plain English — \"roof leaks in Vancouver\". The AI turns that into keywords and scores every post against it.",
  },
  {
    target: "agent-scan",
    route: "/agents",
    title: "4 — Find opportunities",
    body: "Find Opportunities reads everything collected from your sources and scores it. Anything that looks like a real customer becomes a lead, with a reply already drafted for you. This is the button that does the actual work.",
  },
  {
    target: "nav-opportunities",
    route: "/agents",
    title: "5 — Work your leads",
    body: "Scored leads land here, newest and most urgent first. Each one shows why the AI rated it, and gives you a comment and a DM you can send or edit.",
  },
  {
    target: "",
    route: "/opportunities",
    center: true,
    title: "That's the whole loop",
    body: "Sources feed the scan, the scan makes leads, you reply. Everything after this is just repeating it. You can replay this guide any time from How It Works.",
  },
]

const STORAGE_KEY = "oai_tour_v1"

interface TourContextValue {
  active: boolean
  stepIndex: number
  step: TourStep | null
  start: () => void
  next: () => void
  back: () => void
  stop: (completed?: boolean) => void
  hasCompleted: boolean
}

const TourContext = createContext<TourContextValue | null>(null)

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error("useTour must be used inside TourProvider")
  return ctx
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [active, setActive] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [hasCompleted, setHasCompleted] = useState(true) // assume seen until storage says otherwise

  // Read persisted state after mount — localStorage isn't available during SSR,
  // and reading it in render would cause a hydration mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const saved = raw ? JSON.parse(raw) : null
      // Synchronous by necessity, per the note above: storage is unreadable
      // until we are in a browser, so this first read has to happen here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasCompleted(Boolean(saved?.completed))
      // Resume mid-tour after a navigation.
      if (saved?.active && typeof saved.stepIndex === "number") {
        setActive(true)
        setStepIndex(saved.stepIndex)
      }
    } catch {
      setHasCompleted(false)
    }
  }, [])

  const persist = useCallback((next: { active: boolean; stepIndex: number; completed: boolean }) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* private mode / storage disabled — the tour still works, it just won't resume */
    }
  }, [])

  const start = useCallback(() => {
    setActive(true)
    setStepIndex(0)
    persist({ active: true, stepIndex: 0, completed: false })
  }, [persist])

  const stop = useCallback(
    (completed = false) => {
      setActive(false)
      if (completed) setHasCompleted(true)
      persist({ active: false, stepIndex: 0, completed: completed || hasCompleted })
    },
    [persist, hasCompleted]
  )

  const goTo = useCallback(
    (index: number) => {
      if (index < 0) return
      if (index >= TOUR_STEPS.length) {
        stop(true)
        return
      }
      setStepIndex(index)
      persist({ active: true, stepIndex: index, completed: false })
      // Steps can live on different pages; move there and let the resume logic
      // above re-open the tour once the new route mounts.
      const route = TOUR_STEPS[index].route
      if (route !== pathname) router.push(route)
    },
    [pathname, router, persist, stop]
  )

  const next = useCallback(() => goTo(stepIndex + 1), [goTo, stepIndex])
  const back = useCallback(() => goTo(stepIndex - 1), [goTo, stepIndex])

  const value = useMemo(
    () => ({
      active,
      stepIndex,
      step: active ? TOUR_STEPS[stepIndex] ?? null : null,
      start,
      next,
      back,
      stop,
      hasCompleted,
    }),
    [active, stepIndex, start, next, back, stop, hasCompleted]
  )

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}
