"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"
import { formatApiError } from "@/lib/format-error"

export function ScanAgentButton({ id }: { id: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)

  const handleScan = () => {
    setResult(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agents/${id}/scan`, { method: "POST" })
        const data = await res.json()
        if (!res.ok || !data.success) {
          setResult(formatApiError(data.error) || "Scan failed")
          return
        }
        if (data.evaluated === 0) {
          setResult(data.message || "Nothing new to scan.")
        } else {
          setResult(`Scanned ${data.evaluated} posts, found ${data.opportunities_found} opportunities.`)
          router.refresh()
        }
      } catch {
        setResult("Scan failed — check the server log.")
      }
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" onClick={handleScan} disabled={isPending}>
        <Sparkles className="h-3.5 w-3.5" />
        {isPending ? "Scanning…" : "Scan for Opportunities"}
      </Button>
      {result && <p className="text-xs text-muted-foreground">{result}</p>}
    </div>
  )
}
