"use client"

import { useEffect, useState } from "react"
import { Clock, HelpCircle } from "lucide-react"
import { postAge, type PostAge } from "@/lib/post-age"
import { cn } from "@/lib/utils"

/**
 * The age on an opportunity card, kept current.
 *
 * Rendered first with the label the server computed — the same function, so
 * the markup matches on hydration — then recomputed every minute in the
 * browser. A dashboard left open over a morning used to keep saying "12m ago"
 * about a post that was, by then, three hours old.
 *
 * An unknown post date is shown differently, not just prefixed: muted, with a
 * question-mark icon and a tooltip saying what the number actually is.
 */
export function PostAgeLabel({
  postedAt,
  scrapedAt,
  initial,
}: {
  postedAt: string | null
  scrapedAt: string | null
  initial: PostAge
}) {
  const [age, setAge] = useState<PostAge>(initial)

  useEffect(() => {
    const tick = () => {
      const next = postAge(postedAt, scrapedAt)
      if (next) setAge(next)
    }
    const id = window.setInterval(tick, 60_000)
    // First refresh a moment after mount, so a page served from a cache still
    // shows the true age without waiting a full minute.
    const first = window.setTimeout(tick, 1_000)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(first)
    }
  }, [postedAt, scrapedAt])

  return (
    <span
      className={cn("flex items-center gap-1 text-xs", age.known ? "text-muted-foreground" : "text-muted-foreground/80 italic")}
      title={age.known ? `Posted ${age.exact}` : `Post date unknown — we first saw this ${age.exact}. Open the original post to check when it was written.`}
    >
      {age.known ? <Clock className="h-3 w-3" /> : <HelpCircle className="h-3 w-3" />}
      {age.label}
    </span>
  )
}
