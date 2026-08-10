"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sparkles } from "lucide-react"
import { formatApiError } from "@/lib/format-error"

// shortLabel shows in the collapsed trigger (space-constrained); label is the
// unambiguous version shown in the dropdown — "3 days" alone reads as a
// countdown, "Posts from the last 3 days" makes the lookback window explicit.
const RANGE_OPTIONS = [
  { days: 1, shortLabel: "Last 24h", label: "Posts from the last 24 hours" },
  { days: 3, shortLabel: "Last 3 days", label: "Posts from the last 3 days" },
  { days: 7, shortLabel: "Last 7 days (Pro)", label: "Posts from the last 7 days (Pro)" },
]

// Rough estimate for a typical run (scrape ~15 groups + a few paced Gemini
// batches) — used only to animate a believable "almost done" fill, not as a
// real progress signal from the server (which returns one final result, no
// incremental updates). Caps at 92% so it never visually finishes before the
// request actually has.
const ESTIMATED_DURATION_MS = 75000

export function ScanAgentButton({ id }: { id: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const [rangeDays, setRangeDays] = useState(3)
  const [progress, setProgress] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const startProgress = () => {
    const startedAt = Date.now()
    setProgress(3)
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt
      setProgress(3 + Math.min(89, (elapsed / ESTIMATED_DURATION_MS) * 89))
    }, 250)
  }

  const finishProgress = () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setProgress(100)
    setTimeout(() => setProgress(0), 500)
  }

  const handleScan = () => {
    setResult(null)
    startProgress()
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agents/${id}/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rangeDays }),
        })
        const data = await res.json()
        const scrapedNote = data.scraped > 0 ? ` (+${data.scraped} new posts collected)` : ""
        if (!res.ok || !data.success) {
          setResult((formatApiError(data.error) || "Couldn't finish — try again.") + scrapedNote)
          finishProgress()
          return
        }
        // Worth showing: posts the local filter resolved never reached the AI,
        // so they cost nothing. Saying so turns an invisible optimization into
        // a visible reason the scan was cheap.
        const savedNote =
          data.locally_filtered > 0 ? ` — ${data.locally_filtered} skipped the AI, free` : ""
        // A broken extractor has to outrank the normal result line. Left to the
        // scrape log it reads as an ordinary quiet run, which is how a dead
        // source can go unnoticed for weeks.
        const broken: string[] = data.broken_platforms ?? []
        const brokenNote =
          broken.length > 0
            ? ` ⚠ ${broken.join(" and ")} collected nothing and looks broken — check the scrape log.`
            : ""
        if (data.evaluated === 0) {
          setResult((data.message || "Nothing new to scan.") + scrapedNote + brokenNote)
        } else {
          setResult(
            `Scanned ${data.evaluated} posts${scrapedNote}, found ${data.opportunities_found} opportunities${savedNote}.${brokenNote}`
          )
        }
        finishProgress()
        router.refresh()
      } catch {
        setResult("Scan failed — check the server log.")
        finishProgress()
      }
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Select
          value={String(rangeDays)}
          onValueChange={(v) => v && setRangeDays(Number(v))}
          disabled={isPending}
        >
          <SelectTrigger className="w-36 shrink-0" aria-label="Scan lookback range">
            <SelectValue>
              {(v: string) => RANGE_OPTIONS.find((opt) => String(opt.days) === v)?.shortLabel}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((opt) => (
              <SelectItem key={opt.days} value={String(opt.days)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="relative flex-1 overflow-hidden"
          onClick={handleScan}
          disabled={isPending}
          data-tour="agent-scan"
        >
          {isPending && (
            <span
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand/25 to-brand/40 transition-[width] duration-300 ease-linear"
              style={{ width: `${progress}%` }}
            />
          )}
          <span className="relative flex items-center gap-1.5">
            <Sparkles className={`h-3.5 w-3.5 ${isPending ? "animate-pulse" : ""}`} />
            {isPending ? "Finding opportunities… (can take a few minutes)" : "Find Opportunities"}
          </span>
        </Button>
      </div>
      {result && <p className="text-xs text-muted-foreground">{result}</p>}
    </div>
  )
}
