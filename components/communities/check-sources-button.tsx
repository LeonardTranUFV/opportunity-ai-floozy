"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RefreshCw, CircleCheck, CircleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatApiError, CONNECTION_ERROR } from "@/lib/format-error"

/**
 * "Scrape" is deliberately absent from everything a user reads. It describes
 * the mechanism accurately, but it frames the product as a lead-harvester —
 * the framing the public copy has always avoided, and the one most likely to
 * draw platform attention. The API route and database columns still use the
 * word; those are internal and renaming them would need a migration.
 */
export function CheckSourcesButton({ disabledReason }: { disabledReason?: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const handleCheck = () => {
    setResult(null)
    setLog([])
    startTransition(async () => {
      try {
        const res = await fetch("/api/scrape", { method: "POST" })

        // Read as text first. A run the platform cut off comes back as a 504
        // whose body is an HTML error page, and calling res.json() on that
        // throws — which landed in the catch below and told the customer to
        // "check the server log", the one thing they cannot do and the one
        // message that makes a partial run look like a broken product.
        const raw = await res.text()
        let data: { success?: boolean; error?: string; log?: string[]; scraped?: number; message?: string } | null =
          null
        try {
          data = JSON.parse(raw)
        } catch {
          data = null
        }

        if (!data) {
          setIsError(true)
          setResult(
            res.status === 504 || res.status === 502
              ? "That took longer than the server allows and was stopped partway. Sources are read oldest-first, so run it again and it carries on where it left off."
              : `Couldn't check your sources — the server returned ${res.status}.`
          )
          return
        }

        if (!res.ok || !data.success) {
          setIsError(true)
          setResult(formatApiError(data.error) || "Couldn't check your sources — try again.")
          setLog(data.log || [])
          return
        }
        setIsError(false)
        setResult(
          data.scraped === 0
            ? data.message || "No new posts found."
            : `Collected ${data.scraped} new post(s) — ready to scan on the Agents page.`
        )
        setLog(data.log || [])
        router.refresh()
      } catch {
        setIsError(true)
        setResult(CONNECTION_ERROR)
      }
    })
  }

  if (disabledReason) {
    return (
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
        <Button variant="outline" size="sm" disabled className="w-full sm:w-fit">
          <RefreshCw className="h-3.5 w-3.5" />
          Check for new posts
        </Button>
        <span className="text-xs text-muted-foreground">{disabledReason}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Stacked on a phone. Side by side, a three-line paragraph squeezes the
          button into a sliver and wraps itself into a ribbon two words wide —
          which is what this looked like on the device most customers use. */}
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
        <Button
          variant="outline"
          size="sm"
          onClick={handleCheck}
          disabled={isPending}
          className="w-full sm:w-fit"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
          {isPending ? "Checking your sources… (can take a minute)" : "Check for new posts"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Optional — every &quot;Find Opportunities&quot; already does this first. Sources checked in the
          last 15 min are skipped, so running this before scanning several agents makes those faster.
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
