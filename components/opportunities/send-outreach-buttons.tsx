"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { MessageSquare, Send, Check } from "lucide-react"
import { formatApiError, readApiError, CONNECTION_ERROR } from "@/lib/format-error"

/**
 * Two actions, one rule: the software drafts, a person sends.
 *
 * **Comment** used to publish automatically, on the argument that a public
 * comment is not a message to an electronic address and so falls outside the
 * anti-spam rules. True, and beside the point. Meta's terms prohibit
 * automating a logged-in session, that is the rule that actually gets
 * enforced, and the account it costs is the customer's. It also published in
 * their name, in public, without them having read it.
 *
 * **DM** was already prepared here and sent by the operator, in their own
 * Messenger, in their own name — a direct message to somebody who never asked
 * to hear from us is a commercial electronic message under CASL, needing
 * consent, sender identification and an unsubscribe route that a stranger's
 * group post does not provide.
 *
 * So both now work the same way: copy the draft, open the place it goes, and
 * the person decides. The two-step is deliberate friction. It is the
 * difference between outreach and a bot.
 *
 * Automation belongs *after* the other person replies — answering an inquiry
 * is a different act from starting one — and that does not live in this file.
 */

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

type Channel = "comment" | "dm"

export function SendOutreachButtons({ id, platform, hasComment, hasDm, hasPostUrl, hasProfileUrl, commentSentAt, dmSentAt }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState<Channel | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Set once the draft is on the clipboard and the destination is open, so the
  // button can stop offering "prepare" and start offering "I sent it".
  const [prepared, setPrepared] = useState<Record<Channel, boolean>>({ comment: false, dm: false })

  if (platform !== "facebook" || (!hasComment && !hasDm)) return null

  /** Copies the draft and opens where it goes. Sends nothing, publishes nothing. */
  const prepare = (channel: Channel) => {
    setError(null)
    setPending(channel)
    ;(async () => {
      try {
        const res = await fetch(`/api/opportunities/${id}/${channel}`, { method: "POST" })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          setError(
            data ? formatApiError(data.error) : await readApiError(res, "Could not prepare that")
          )
          return
        }
        try {
          await navigator.clipboard.writeText(data.message)
        } catch {
          // Clipboard can be refused; the destination still opens and the text
          // is on screen, so this is a convenience rather than the mechanism.
        }
        window.open(data.openUrl, "_blank", "noopener,noreferrer")
        setPrepared((p) => ({ ...p, [channel]: true }))
      } catch {
        setError(CONNECTION_ERROR)
      } finally {
        setPending(null)
      }
    })()
  }

  const markSent = (channel: Channel) => {
    setError(null)
    setPending(channel)
    ;(async () => {
      try {
        const res = await fetch(`/api/opportunities/${id}/${channel}`, { method: "PATCH" })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          setError(data ? formatApiError(data.error) : "Could not record that")
          return
        }
        setPrepared((p) => ({ ...p, [channel]: false }))
        router.refresh()
      } catch {
        setError("Could not record that")
      } finally {
        setPending(null)
      }
    })()
  }

  const commentLabel = () => {
    if (pending === "comment") return "Working…"
    if (commentSentAt) return "Comment posted"
    if (prepared.comment) return "I posted it"
    return "Open post"
  }

  const dmLabel = () => {
    if (pending === "dm") return "Working…"
    if (dmSentAt) return "DM sent"
    if (prepared.dm) return "I sent it"
    return "Open DM"
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          // Already posted is a state, not an invitation — leaving it live let
          // the same drafted reply go onto a stranger's post twice, which reads
          // as exactly the spam this feature is trying not to be.
          disabled={!hasComment || !hasPostUrl || (!!commentSentAt && !prepared.comment) || pending !== null}
          onClick={() => (prepared.comment ? markSent("comment") : prepare("comment"))}
        >
          {commentSentAt ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
          {commentLabel()}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!hasDm || !hasProfileUrl || (!!dmSentAt && !prepared.dm) || pending !== null}
          onClick={() => (prepared.dm ? markSent("dm") : prepare("dm"))}
        >
          {dmSentAt ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {dmLabel()}
        </Button>
      </div>

      {hasComment && !hasPostUrl && !commentSentAt && (
        <p className="text-xs text-muted-foreground">
          The platform gave us a link to the group, not to the post, so we can&apos;t point you at
          the right one. Open the group and reply there yourself.
        </p>
      )}
      {prepared.comment && !commentSentAt && (
        <p className="text-xs text-muted-foreground">
          Copied and opened on Facebook. Read the post, change anything that does not fit, and
          post it yourself — then mark it here. Replying publicly on the thread is safer than a
          direct message; save the DM for after they answer.
        </p>
      )}
      {prepared.dm && !dmSentAt && (
        <p className="text-xs text-muted-foreground">
          Copied and opened in Messenger. Read it, change anything that does not fit, and send it
          yourself — then mark it here.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
