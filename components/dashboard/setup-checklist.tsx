import Link from "next/link"
import { Check, ArrowRight, KeyRound, Compass, Users, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

export interface SetupState {
  hasScrapedPosts: boolean
  hasSources: boolean
  hasAgents: boolean
  hasOpportunities: boolean
}

/**
 * First-run checklist.
 *
 * Every step is derived from real evidence in the database rather than a
 * "dismissed onboarding" flag — so it can't claim a step is done when it
 * isn't, and it re-appears honestly if someone deletes all their sources.
 * It hides itself entirely once the pipeline has produced leads, so
 * established users never see it.
 */
export function SetupChecklist({ state }: { state: SetupState }) {
  const steps = [
    {
      done: state.hasScrapedPosts,
      icon: KeyRound,
      title: "Connect an account",
      body: "Log into Facebook, LinkedIn, Nextdoor or X so the app can see what you see.",
      href: "/accounts",
      cta: "Connect",
      tone: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-500/10",
    },
    {
      done: state.hasSources,
      icon: Compass,
      title: "Add somewhere to watch",
      body: "Pick the groups or searches to monitor. Not sure? Get suggestions on the Communities page.",
      href: "/communities",
      cta: "Add a source",
      tone: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      done: state.hasAgents,
      icon: Users,
      title: "Create an AI agent",
      body: "Describe what you're looking for in plain language. The AI scores every post against it.",
      href: "/agents/new",
      cta: "Create agent",
      tone: "text-violet-600 dark:text-violet-400",
      bg: "bg-violet-500/10",
    },
    {
      done: state.hasOpportunities,
      icon: Sparkles,
      title: "Find your first opportunities",
      body: "Turns collected posts into scored leads with a reply already drafted.",
      href: "/agents",
      cta: "Find opportunities",
      tone: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-500/10",
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  // Once real leads exist the product has proven itself — stop nagging.
  if (state.hasOpportunities) return null

  const next = steps.find((s) => !s.done)

  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-col">
          <span className="font-heading text-sm font-medium">Finish setting up</span>
          <span className="text-xs text-muted-foreground">
            {doneCount} of {steps.length} done — leads start arriving after the last step.
          </span>
        </div>
        <div className="flex items-center gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <span
              key={i}
              className={cn("h-1.5 w-8 rounded-full", s.done ? "bg-brand" : "bg-muted")}
            />
          ))}
        </div>
      </div>

      <ol className="divide-y divide-border">
        {steps.map((s) => {
          const isNext = s === next
          return (
            <li
              key={s.title}
              className={cn(
                "flex flex-wrap items-center gap-3 px-4 py-3",
                s.done && "opacity-55"
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  s.done ? "bg-emerald-500/15" : s.bg
                )}
              >
                {s.done ? (
                  <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <s.icon className={cn("size-4", s.tone)} />
                )}
              </span>

              <div className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-sm font-medium", s.done && "line-through")}>{s.title}</span>
                {!s.done && <span className="text-xs text-muted-foreground">{s.body}</span>}
              </div>

              {!s.done && (
                <Link
                  href={s.href}
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors",
                    isNext
                      ? "bg-foreground text-background hover:opacity-90"
                      : "border border-border hover:bg-muted"
                  )}
                >
                  {s.cta}
                  <ArrowRight className="size-3.5" />
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
