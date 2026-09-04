"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RefreshCw, TriangleAlert, CircleAlert } from "lucide-react"
import { formatApiError } from "@/lib/format-error"

/**
 * The "run it from your own computer" branch is gone, and with it the `hosted`
 * prop that selected it.
 *
 * That instruction was true when refreshing meant launching Chrome on the
 * operator's machine. It isn't now: /api/scrape opens a cloud browser for the
 * signed-in platforms, and Reddit never needed one — so a hosted customer was
 * being told to do something impossible in order to reach a button that would
 * have worked.
 */
export function StaleSourcesBanner() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleRefresh = () => {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch("/api/scrape", { method: "POST" })
        const data = await res.json()
        if (!res.ok || !data.success) {
          setError(formatApiError(data.error) || "Couldn't refresh sources — try again.")
          return
        }
        router.refresh()
      } catch {
        setError("Couldn't refresh sources — check the server log.")
      }
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            You haven&apos;t refreshed your sources today — auto-scan and manual scans only look at posts
            already saved, so they&apos;ll keep re-checking the same old ones until you refresh.
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isPending} className="shrink-0">
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
          {isPending ? "Refreshing…" : "Refresh Sources Now"}
        </Button>
      </div>
      {error && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
