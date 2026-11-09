"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { GROUP_REQUEST_STATUS_LABEL, type GroupRequestStatus } from "@/lib/group-requests"

export type ClientGroupRequest = {
  id: string
  url: string
  name: string | null
  status: GroupRequestStatus
  decline_reason: string | null
}

export function GroupRequestCard({ requests }: { requests: ClientGroupRequest[] }) {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setSent(false)
    try {
      const res = await fetch("/api/group-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, name, note }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Could not send that request.")
        return
      }
      setUrl("")
      setName("")
      setNote("")
      setSent(true)
      router.refresh()
    } catch {
      setError("Could not reach the server. Check your connection.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request a Facebook group</CardTitle>
        <CardDescription>
          Paste a local group where your customers post. Floozy joins it and reads it with our own accounts, so you
          don&apos;t need to connect your Facebook.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="facebook.com/groups/..."
            aria-label="Facebook group link"
          />
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Group name (optional)"
            aria-label="Group name"
            maxLength={200}
          />
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything we should know? (optional)"
            aria-label="Note for Floozy"
            maxLength={500}
          />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {sent && <p className="text-sm text-emerald-600 dark:text-emerald-400">Sent. We&apos;ll show its progress here.</p>}
          <Button type="submit" variant="brand" disabled={busy} className="self-start">
            {busy ? "Sending…" : "Send request"}
          </Button>
        </form>

        {requests.length > 0 && (
          <ul className="flex flex-col gap-2 border-t border-border pt-4">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <a href={request.url} target="_blank" rel="noreferrer" className="min-w-0 truncate underline-offset-2 hover:underline">
                  {request.name ?? request.url}
                </a>
                <Badge variant={request.status === "active" ? "secondary" : "outline"}>
                  {GROUP_REQUEST_STATUS_LABEL[request.status]}
                </Badge>
                {request.status === "declined" && request.decline_reason && (
                  <p className="w-full text-xs text-muted-foreground">{request.decline_reason}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
