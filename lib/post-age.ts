import { formatDate, formatDateTimeFull } from "@/lib/format-date"

/**
 * How old a post is, said honestly.
 *
 * Two different facts get shown here and they must never look alike:
 *
 *   posted_at — when the person actually wrote the post. Parsed from the
 *     platform at scrape time; present on about one Facebook post in ten,
 *     because the feed shows most dates as "15 May" and the parser only
 *     understood "2h" and "3d" (fixed alongside this file, but the backlog
 *     has no date and never will).
 *
 *   scraped_at — when we first saw it. Always set.
 *
 * The card used to print "~2d ago" from scraped_at when posted_at was
 * missing. A post written in May and collected in September read as two days
 * old, across most of the feed, and the only hint was the tilde. So a missing
 * post date now says "seen 2d ago" with a tooltip that says the post date is
 * unknown — a customer deciding whether to call needs to know which of the
 * two numbers they are looking at.
 */
export interface PostAge {
  label: string
  /** Full timestamp for the tooltip. */
  exact: string
  /** True when the label is the post's own date, false when it is when we saw it. */
  known: boolean
}

export function relativeLabel(date: Date, now = Date.now()): string {
  const diffMs = now - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  // Pinned locale and time zone — see lib/format-date.ts.
  return formatDate(date)
}

export function postAge(postedAt: string | null, scrapedAt: string | null, now = Date.now()): PostAge | null {
  const known = !!postedAt
  const iso = postedAt || scrapedAt
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const rel = relativeLabel(date, now)
  return {
    label: known ? rel : `seen ${rel}`,
    exact: formatDateTimeFull(date),
    known,
  }
}
