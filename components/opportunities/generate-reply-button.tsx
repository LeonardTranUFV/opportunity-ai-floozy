"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Sparkles, Copy, Check } from "lucide-react"
import { formatApiError } from "@/lib/format-error"

function DraftBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <Button variant="ghost" size="xs" onClick={handleCopy}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-sm">{text}</p>
    </div>
  )
}

export function GenerateReplyButton({
  id,
  initialComment,
  initialDm,
}: {
  id: string
  initialComment: string | null
  initialDm: string | null
}) {
  const [isPending, startTransition] = useTransition()
  const [comment, setComment] = useState(initialComment)
  const [dm, setDm] = useState(initialDm)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = () => {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/opportunities/${id}/reply`, { method: "POST" })
        const data = await res.json()
        if (!res.ok || !data.success) {
          setError(formatApiError(data.error) || "Failed to generate response")
          return
        }
        setComment(data.comment)
        setDm(data.dm)
      } catch {
        setError("Failed to generate response")
      }
    })
  }

  if (comment || dm) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
        {comment && <DraftBlock label="Comment draft" text={comment} />}
        {comment && dm && <div className="h-px bg-border" />}
        {dm && <DraftBlock label="DM draft" text={dm} />}
        <Button variant="ghost" size="xs" className="w-fit" onClick={handleGenerate} disabled={isPending}>
          {isPending ? "Regenerating…" : "Regenerate both"}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" onClick={handleGenerate} disabled={isPending}>
        <Sparkles className="h-3.5 w-3.5" />
        {isPending ? "Writing…" : "Generate Personalized Response"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
