"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"
import { formatApiError } from "@/lib/format-error"

const RANGE_OPTIONS = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days (Pro)" },
]

export function ScanAgentButton({ id }: { id: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const [rangeDays, setRangeDays] = useState(3)

  const handleScan = () => {
    setResult(null)
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
          return
        }
        if (data.evaluated === 0) {
          setResult((data.message || "Nothing new to scan.") + scrapedNote)
        } else {
          setResult(`Scanned ${data.evaluated} posts${scrapedNote}, found ${data.opportunities_found} opportunities.`)
        }
        router.refresh()
      } catch {
        setResult("Scan failed — check the server log.")
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
        <Button variant="outline" size="sm" className="flex-1" onClick={handleScan} disabled={isPending}>
          <Sparkles className={`h-3.5 w-3.5 ${isPending ? "animate-pulse" : ""}`} />
          {isPending ? "Scraping & scanning… (can take a few minutes)" : "Scan for Opportunities"}
        </Button>
      </div>
      {result && <p className="text-xs text-muted-foreground">{result}</p>}
    </div>
  )
}
