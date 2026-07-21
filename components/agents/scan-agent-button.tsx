"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"
import { formatApiError } from "@/lib/format-error"

const RANGE_OPTIONS = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days (Pro)" },
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
        const scrapedNote = data.scraped > 0 ? ` (+${data.scraped} freshly scraped)` : ""
        if (!res.ok || !data.success) {
          setResult((formatApiError(data.error) || "Scan failed") + scrapedNote)
          finishProgress()
          return
        }
        if (data.evaluated === 0) {
          setResult((data.message || "Nothing new to scan.") + scrapedNote)
        } else {
          setResult(`Scanned ${data.evaluated} posts${scrapedNote}, found ${data.opportunities_found} opportunities.`)
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
        <select
          value={rangeDays}
          onChange={(e) => setRangeDays(Number(e.target.value))}
          disabled={isPending}
          className="h-8 shrink-0 rounded-md border bg-background px-2 text-xs"
          aria-label="Scan lookback range"
        >
          {RANGE_OPTIONS.map((opt) => (
            <option key={opt.days} value={opt.days}>
              {opt.label}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          className="relative flex-1 overflow-hidden"
          onClick={handleScan}
          disabled={isPending}
        >
          {isPending && (
            <span
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-brand/25 to-brand/40 transition-[width] duration-300 ease-linear"
              style={{ width: `${progress}%` }}
            />
          )}
          <span className="relative flex items-center gap-1.5">
            <Sparkles className={`h-3.5 w-3.5 ${isPending ? "animate-pulse" : ""}`} />
            {isPending ? "Scraping & scanning… (can take a few minutes)" : "Scan for Opportunities"}
          </span>
        </Button>
      </div>
      {result && <p className="text-xs text-muted-foreground">{result}</p>}
    </div>
  )
}
