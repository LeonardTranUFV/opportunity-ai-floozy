"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RefreshCw, CircleCheck, CircleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatApiError } from "@/lib/format-error"

export function ScrapeNowButton({ disabledReason }: { disabledReason?: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const handleScrape = () => {
    setResult(null)
    setLog([])
    startTransition(async () => {
      try {
        const res = await fetch("/api/scrape", { method: "POST" })
        const data = await res.json()
        if (!res.ok || !data.success) {
          setIsError(true)
          setResult(formatApiError(data.error) || "Scrape failed")
          setLog(data.log || [])
          return
        }
        setIsError(false)
        setResult(
          data.scraped === 0
            ? data.message || "No new posts found."
            : `Scraped ${data.scraped} post(s) across your active groups — ready to scan on the Agents page.`
        )
        setLog(data.log || [])
        router.refresh()
      } catch {
        setIsError(true)
        setResult("Scrape failed — check the server log.")
      }
    })
  }

  if (disabledReason) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled className="w-fit">
          <RefreshCw className="h-3.5 w-3.5" />
          Scrape Active Groups Now
        </Button>
        <span className="text-xs text-muted-foreground">{disabledReason}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleScrape} disabled={isPending} className="w-fit">
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
          {isPending ? "Scraping active groups… (can take a minute)" : "Scrape Active Groups Now"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Optional — every &quot;Scan for Opportunities&quot; already does this first. Groups scraped in the
          last 15 min are skipped, so running this before scanning several agents makes those scans faster.
        </span>
      </div>
      {result && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
            isError
              ? "border-destructive/20 bg-destructive/5 text-destructive"
              : "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
          )}
        >
          {isError ? (
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>{result}</span>
        </div>
      )}
      {log.length > 0 && (
        <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground">
          {log.map((line, i) => (
            <li key={i} className="font-mono">
              <span className="text-muted-foreground/50">·</span> {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
