"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { MessageSquare, Send, Check } from "lucide-react"
import { formatApiError } from "@/lib/format-error"

interface Props {
  id: string
  platform: string
  hasComment: boolean
  hasDm: boolean
  hasPostUrl: boolean
  hasProfileUrl: boolean
  commentSentAt: string | null
  dmSentAt: string | null
}

export function SendOutreachButtons({ id, platform, hasComment, hasDm, hasPostUrl, hasProfileUrl, commentSentAt, dmSentAt }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState<"comment" | "dm" | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (platform !== "facebook" || (!hasComment && !hasDm)) return null

  const send = (kind: "comment" | "dm") => {
    const label = kind === "comment" ? "post this as a public comment on the original post" : "send this as a Facebook DM to the author"
    if (!confirm(`This will actually ${label}, right now, using your connected Facebook account. Continue?`)) return

    setError(null)
    setPending(kind)
    ;(async () => {
      try {
        const res = await fetch(`/api/opportunities/${id}/${kind}`, { method: "POST" })
        const data = await res.json()
        if (!res.ok || !data.success) {
          setError(formatApiError(data.error) || `Failed to send ${kind}`)
          return
        }
        router.refresh()
      } catch {
        setError(`Failed to send ${kind}`)
      } finally {
        setPending(null)
      }
    })()
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!hasComment || !hasPostUrl || pending !== null}
          onClick={() => send("comment")}
        >
          {commentSentAt ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
          {pending === "comment" ? "Posting…" : commentSentAt ? "Comment Sent" : "Send Comment"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!hasDm || !hasProfileUrl || pending !== null}
          onClick={() => send("dm")}
        >
          {dmSentAt ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {pending === "dm" ? "Sending…" : dmSentAt ? "DM Sent" : "Send DM"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
