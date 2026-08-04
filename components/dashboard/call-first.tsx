import Link from "next/link"
import { ArrowUpRight, MapPin, CheckCircle2 } from "lucide-react"
import { platformMeta } from "@/lib/platform-meta"

interface Lead {
  id: string
  author_name: string
  ai_summary: string | null
  content: string
  urgency: string
  location_mentioned: string | null
  platform: string | null
  post_url: string | null
  created_at: string
}

/**
 * Splits elapsed time into a big number + small unit so the figure can carry
 * the layout. Freshness is the one number that actually changes what a
 * contractor does next — a 20-minute-old request is worth far more than a
 * two-day-old one — so it gets the display-face treatment, not the counts.
 */
function elapsed(iso: string): { value: string; unit: string; stale: boolean } {
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.max(0, Math.floor(ms / 60000))
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 60) return { value: String(minutes), unit: minutes === 1 ? "min ago" : "mins ago", stale: false }
  if (hours < 24) return { value: String(hours), unit: hours === 1 ? "hour ago" : "hours ago", stale: hours >= 6 }
  return { value: String(days), unit: days === 1 ? "day ago" : "days ago", stale: true }
}

const URGENCY = {
  asap: {
    label: "ASAP",
    chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/25",
    rail: "bg-rose-500",
    glow: "from-rose-500/[0.07]",
  },
  high: {
    label: "High intent",
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/25",
    rail: "bg-amber-500",
    glow: "from-amber-500/[0.07]",
  },
} as const

export function CallFirst({ lead }: { lead: Lead | null }) {
  if (!lead) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-3.5 ring-1 ring-foreground/10">
        <CheckCircle2 className="size-4.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="flex flex-col">
          <span className="font-heading text-sm font-medium">You&apos;re caught up</span>
          <span className="text-sm text-muted-foreground">
            No urgent leads waiting. New ones show up here the moment they&apos;re found.
          </span>
        </div>
      </div>
    )
  }

  const tone = URGENCY[lead.urgency as keyof typeof URGENCY] ?? URGENCY.high
  const time = elapsed(lead.created_at)
  const { label: platformLabel, Icon } = platformMeta(lead.platform ?? "")

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-gradient-to-r ${tone.glow} to-transparent bg-card ring-1 ring-foreground/10`}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${tone.rail}`} />

      <div className="flex flex-col gap-4 py-4 pl-5 pr-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Call first
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-medium ring-1 ${tone.chip}`}>
              {tone.label}
            </span>
          </div>

          <p className="font-heading text-lg leading-snug font-medium">
            {lead.ai_summary || lead.content}
          </p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{lead.author_name}</span>
            {lead.location_mentioned && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" />
                {lead.location_mentioned}
              </span>
            )}
            {lead.platform && (
              <span className="flex items-center gap-1.5">
                <Icon className="size-3.5" />
                {platformLabel}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-5">
          <div className="flex flex-col items-end leading-none">
            <span
              className={`font-heading text-4xl font-semibold tabular-nums ${
                time.stale ? "text-muted-foreground" : "text-foreground"
              }`}
            >
              {time.value}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">{time.unit}</span>
          </div>

          <Link
            // Deep-link to this exact lead. Previously this opened the
            // high-intent *list*, leaving the user to re-find the one they
            // just read — the whole point of this card is one-tap action.
            href={`/opportunities?id=${lead.id}`}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Open lead
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
