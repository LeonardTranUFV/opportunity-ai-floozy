"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Sparkles, Copy, Check } from "lucide-react"
import { formatApiError } from "@/lib/format-error"

export function GenerateReplyButton({ id, initialReply }: { id: number; initialReply: string | null }) {
  const [isPending, startTransition] = useTransition()
  const [reply, setReply] = useState(initialReply)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = () => {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/opportunities/${id}/reply`, { method: "POST" })
        const data = await res.json()
        if (!res.ok || !data.success) {
          setError(formatApiError(data.error) || "Failed to generate reply")
          return
        }
        setReply(data.reply)
      } catch {
        setError("Failed to generate reply")
      }
    })
  }

  const handleCopy = () => {
    if (!reply) return
    navigator.clipboard.writeText(reply)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (reply) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
        <p className="text-sm">{reply}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="xs" onClick={handleCopy}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="ghost" size="xs" onClick={handleGenerate} disabled={isPending}>
            {isPending ? "Regenerating…" : "Regenerate"}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" onClick={handleGenerate} disabled={isPending}>
        <Sparkles className="h-3.5 w-3.5" />
        {isPending ? "Writing…" : "Generate AI Reply"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
