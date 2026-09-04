"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { MessageSquare, Send, Check } from "lucide-react"
import { formatApiError, readApiError, CONNECTION_ERROR } from "@/lib/format-error"

/**
 * Two different actions that only look alike.
 *
 * **Comment** posts automatically. A comment is published on a public post, not
 * sent to anybody's inbox, so it sits outside the anti-spam rules that govern
 * electronic messages — and it is visible to the author's whole audience, which
 * keeps it self-policing.
 *
 * **DM** is prepared here and sent by the operator, in their own Messenger, in
 * their own name. A direct message to somebody who never asked to hear from us
 * is a commercial electronic message under CASL: it needs consent, sender
 * identification and an unsubscribe route, none of which a stranger's group post
 * provides. Having the software send it made the software the sender. Having a
 * person send it means a person looked at the recipient and decided.
 *
 * The two-step is deliberate friction. It is the difference between outreach
 * and a bot.
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

export function SendOutreachButtons({ id, platform, hasComment, hasDm, hasPostUrl, hasProfileUrl, commentSentAt, dmSentAt }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState<"comment" | "dm" | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Set once the message is on the clipboard and Messenger is open, so the
  // button can stop offering "prepare" and start offering "I sent it".
  const [dmPrepared, setDmPrepared] = useState(false)

  if (platform !== "facebook" || (!hasComment && !hasDm)) return null

  const sendComment = () => {
    if (!confirm("This will post this as a public comment on the original post, right now, using your connected Facebook account. Continue?")) return
    setError(null)
    setPending("comment")
    ;(async () => {
      try {
        const res = await fetch(`/api/opportunities/${id}/comment`, { method: "POST" })
        if (!res.ok) {
          setError(await readApiError(res, "Couldn't post that comment"))
          return
        }
        const data = await res.json()
        if (!data.success) {
          setError(data.error || "Couldn't post that comment.")
          return
        }
        router.refresh()
      } catch {
        setError(CONNECTION_ERROR)
      } finally {
        setPending(null)
      }
    })()
  }

  /** Copies the message and opens the thread. Sends nothing. */
  const prepareDm = () => {
    setError(null)
    setPending("dm")
    ;(async () => {
      try {
        const res = await fetch(`/api/opportunities/${id}/dm`, { method: "POST" })
        const data = await res.json()
        if (!res.ok || !data.success) {
          setError(formatApiError(data.error) || "Could not prepare the message")
          return
        }
        try {
          await navigator.clipboard.writeText(data.message)
        } catch {
          // Clipboard can be refused; the thread still opens and the text is
          // on screen, so this is a convenience rather than the mechanism.
        }
        window.open(data.openUrl, "_blank", "noopener,noreferrer")
        setDmPrepared(true)
      } catch {
        setError("Could not prepare the message")
      } finally {
        setPending(null)
      }
    })()
  }

  const markDmSent = () => {
    setError(null)
    setPending("dm")
    ;(async () => {
      try {
        const res = await fetch(`/api/opportunities/${id}/dm`, { method: "PATCH" })
        const data = await res.json()
        if (!res.ok || !data.success) {
          setError(formatApiError(data.error) || "Could not record that")
          return
        }
        setDmPrepared(false)
        router.refresh()
      } catch {
        setError("Could not record that")
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
          // Already posted is a state, not an invitation. Leaving it live let
          // a customer post the same drafted reply onto a stranger's post
          // twice, from their own account, which reads as exactly the spam
          // this feature is trying not to be.
          disabled={!hasComment || !hasPostUrl || !!commentSentAt || pending !== null}
          onClick={sendComment}
        >
          {commentSentAt ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
          {pending === "comment" ? "Posting…" : commentSentAt ? "Comment posted" : "Post comment"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!hasDm || !hasProfileUrl || (!!dmSentAt && !dmPrepared) || pending !== null}
          onClick={dmPrepared ? markDmSent : prepareDm}
        >
          {dmSentAt ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {pending === "dm"
            ? "Working…"
            : dmSentAt
              ? "DM sent"
              : dmPrepared
                ? "I sent it"
                : "Open DM"}
        </Button>
      </div>

      {hasComment && !hasPostUrl && !commentSentAt && (
        <p className="text-xs text-muted-foreground">
          Commenting is off for this lead: the platform gave us a link to the group, not to the
          post, so we can&apos;t be certain a comment would land on the right one. Open the group
          and reply there yourself.
        </p>
      )}
      {dmPrepared && !dmSentAt && (
        <p className="text-xs text-muted-foreground">
          Copied and opened in Messenger. Read it, change anything that does not fit, and send it
          yourself — then mark it here.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
