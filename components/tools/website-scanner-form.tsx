"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CheckCircle2, XCircle, Search } from "lucide-react"
import { formatApiError } from "@/lib/format-error"

interface WebsiteCheck {
  label: string
  pass: boolean
  detail: string
}

interface ScanResult {
  url: string
  statusCode: number
  loadTimeMs: number
  score: number
  checks: WebsiteCheck[]
  aiReport: string | null
  aiError: string | null
}

export function WebsiteScannerForm() {
  const [url, setUrl] = useState("")
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResult(null)
    startTransition(async () => {
      try {
        const res = await fetch("/api/tools/website-scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        })
        const data = await res.json()
        if (!res.ok || !data.success) {
          setError(data.error || "Scan failed")
          return
        }
        setResult(data)
      } catch {
        setError("Scan failed — check the server log.")
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleScan} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="scan-url">Website URL</Label>
          <Input
            id="scan-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="example.com"
            required
          />
        </div>
        <Button type="submit" disabled={isPending}>
          <Search className="h-3.5 w-3.5" />
          {isPending ? "Scanning…" : "Scan Website"}
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <div className="text-3xl font-bold">{result.score}/100</div>
            <div className="text-sm text-muted-foreground">
              {result.url} · {result.loadTimeMs}ms · HTTP {result.statusCode}
            </div>
          </div>

          {result.aiReport && (
            <p className="rounded-lg border bg-muted/30 p-3 text-sm">{result.aiReport}</p>
          )}
          {result.aiError && (
            <p className="text-xs text-muted-foreground">
              AI summary unavailable right now ({formatApiError(result.aiError)}) — checklist below is still
              accurate.
            </p>
          )}

          <div className="flex flex-col gap-2">
            {result.checks.map((check) => (
              <div key={check.label} className="flex items-start gap-2 text-sm">
                {check.pass ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                )}
                <div>
                  <span className="font-medium">{check.label}: </span>
                  <span className="text-muted-foreground">{check.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
