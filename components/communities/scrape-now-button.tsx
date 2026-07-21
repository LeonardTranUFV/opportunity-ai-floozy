"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { formatApiError } from "@/lib/format-error"

export function ScrapeNowButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])

  const handleScrape = () => {
    setResult(null)
    setLog([])
    startTransition(async () => {
      try {
        const res = await fetch("/api/scrape", { method: "POST" })
        const data = await res.json()
        if (!res.ok || !data.success) {
          setResult(formatApiError(data.error) || "Scrape failed")
          setLog(data.log || [])
          return
        }
        setResult(
          data.scraped === 0
            ? data.message || "No new posts found."
            : `Scraped ${data.scraped} post(s) across your active groups — ready to scan on the Agents page.`
        )
        setLog(data.log || [])
        router.refresh()
      } catch {
        setResult("Scrape failed — check the server log.")
      }
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button variant="outline" size="sm" onClick={handleScrape} disabled={isPending}>
        <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
        {isPending ? "Scraping active groups… (can take a minute)" : "Scrape Active Groups Now"}
      </Button>
      {result && <p className="text-xs text-muted-foreground">{result}</p>}
      {log.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {log.map((line, i) => (
            <li key={i}>· {line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
