"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState } from "@/components/ui/empty-state"
import { Mail, Plus, Send, Trash2, Pencil, Clock, Users, TriangleAlert } from "lucide-react"
import { readApiError, CONNECTION_ERROR } from "@/lib/format-error"
import { cn } from "@/lib/utils"

export interface Recipient {
  id: string
  name: string
  email: string | null
  phone: string | null
  agent_ids: string[]
  send_hour: number
  timezone: string
  active: boolean
  last_sent_on: string | null
  last_result: string | null
}
export interface AgentOption {
  id: string
  name: string
}

/** The zones Floozy's clients are actually in, plus whatever a row already holds. */
const ZONES = [
  "America/Vancouver",
  "America/Edmonton",
  "America/Toronto",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Ho_Chi_Minh",
  "Asia/Dubai",
  "UTC",
]

const hourLabel = (h: number) => {
  const suffix = h < 12 ? "am" : "pm"
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve}:00 ${suffix}`
}

const blank = (): Draft => ({
  name: "",
  email: "",
  phone: "",
  agent_ids: [],
  send_hour: 8,
  timezone: "America/Vancouver",
})

interface Draft {
  name: string
  email: string
  phone: string
  agent_ids: string[]
  send_hour: number
  timezone: string
}

export function RecipientsManager({
  initial,
  agents,
  mailReady,
}: {
  initial: Recipient[]
  agents: AgentOption[]
  mailReady: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<string | "new" | null>(null)
  const [draft, setDraft] = useState<Draft>(blank())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const startAdd = () => {
    setDraft(blank())
    setEditing("new")
    setError(null)
  }
  const startEdit = (r: Recipient) => {
    setDraft({
      name: r.name,
      email: r.email ?? "",
      phone: r.phone ?? "",
      agent_ids: r.agent_ids ?? [],
      send_hour: r.send_hour,
      timezone: r.timezone,
    })
    setEditing(r.id)
    setError(null)
  }

  const save = async () => {
    setBusy("save")
    setError(null)
    try {
      const isNew = editing === "new"
      const res = await fetch(isNew ? "/api/lead-recipients" : `/api/lead-recipients/${editing}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      if (!res.ok) {
        setError(await readApiError(res, "Couldn't save."))
        return
      }
      setEditing(null)
      router.refresh()
    } catch {
      setError(CONNECTION_ERROR)
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (r: Recipient) => {
    setBusy(r.id)
    try {
      await fetch(`/api/lead-recipients/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !r.active }),
      })
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const remove = async (r: Recipient) => {
    if (!confirm(`Stop sending leads to ${r.name}? This removes them from the morning send.`)) return
    setBusy(r.id)
    try {
      await fetch(`/api/lead-recipients/${r.id}`, { method: "DELETE" })
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const send = async (r: Recipient, dry: boolean) => {
    setBusy(r.id)
    setNote(null)
    setError(null)
    try {
      const res = await fetch(`/api/lead-recipients/${r.id}/send${dry ? "?dry=1" : ""}`, { method: "POST" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? "Send failed.")
        return
      }
      setNote(
        dry
          ? `${r.name}: ${body.leads} lead${body.leads === 1 ? "" : "s"} would go out right now.`
          : `${r.name}: ${body.status} (${body.leads} lead${body.leads === 1 ? "" : "s"}).`
      )
      if (!dry) router.refresh()
    } catch {
      setError(CONNECTION_ERROR)
    } finally {
      setBusy(null)
    }
  }

  const form = (
    <Card className="border-brand/40">
      <CardHeader>
        <CardTitle className="text-lg">{editing === "new" ? "Add a client" : "Edit client"}</CardTitle>
        <CardDescription>They get one email each morning with the new leads and a spreadsheet attached.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="r-name">Client name</Label>
            <Input
              id="r-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Westcoast Roofing"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="r-email">Email</Label>
            <Input
              id="r-email"
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              placeholder="owner@company.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="r-phone">Phone (optional)</Label>
            <Input
              id="r-phone"
              type="tel"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="604 555 0134"
            />
            <p className="text-xs text-muted-foreground">
              Stored for your records. Leads are sent by email — text-message delivery isn&apos;t built yet.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="r-hour">Send at</Label>
              <select
                id="r-hour"
                value={draft.send_hour}
                onChange={(e) => setDraft({ ...draft, send_hour: Number(e.target.value) })}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="r-tz">Their timezone</Label>
              <select
                id="r-tz"
                value={draft.timezone}
                onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {[...new Set([draft.timezone, ...ZONES])].map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Which agents&apos; leads do they get?</Label>
          <div className="flex flex-wrap gap-2">
            {agents.length === 0 && <p className="text-sm text-muted-foreground">No agents yet.</p>}
            {agents.map((a) => {
              const on = draft.agent_ids.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      agent_ids: on ? draft.agent_ids.filter((x) => x !== a.id) : [...draft.agent_ids, a.id],
                    })
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    on ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  {a.name}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Pick none to send every agent&apos;s leads — so an agent you add later is included automatically.
          </p>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button variant="brand" onClick={save} disabled={busy === "save" || !draft.name.trim()}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="flex flex-col gap-4">
      {!mailReady && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <div className="font-medium">Email isn&apos;t switched on yet.</div>
            <div className="text-muted-foreground">
              You can set clients up now, but nothing will send until <code>GMAIL_USER</code> and{" "}
              <code>GMAIL_APP_PASSWORD</code> are set in Vercel. Preview still works.
            </div>
          </div>
        </div>
      )}

      {note && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm">{note}</div>
      )}
      {error && !editing && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {editing !== null && form}

      {editing === null && (
        <div className="flex justify-end">
          <Button variant="brand" onClick={startAdd}>
            <Plus className="size-4" />
            Add a client
          </Button>
        </div>
      )}

      {initial.length === 0 && editing === null ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Mail}
              title="Nobody is getting the morning email yet"
              description="Add a client, pick which agents' leads they should get, and choose a time. They'll get one email each morning with a spreadsheet of everything new."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {initial.map((r) => (
            <Card key={r.id} className={cn(!r.active && "opacity-60")}>
              <CardContent className="flex flex-col gap-3 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{r.name}</span>
                      {!r.active && <Badge variant="secondary">Paused</Badge>}
                    </div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {r.email ?? "no email"}
                      {r.phone ? ` · ${r.phone}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => send(r, true)} disabled={busy === r.id}>
                      Preview
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => send(r, false)}
                      disabled={busy === r.id || !mailReady || !r.email}
                      title={!r.email ? "This client has no email address" : undefined}
                    >
                      <Send className="size-3.5" />
                      Send now
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(r)} aria-label={`Edit ${r.name}`}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(r)} aria-label={`Remove ${r.name}`}>
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Clock className="size-3.5" />
                    {hourLabel(r.send_hour)} · {r.timezone.replace(/_/g, " ")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Users className="size-3.5" />
                    {r.agent_ids.length === 0
                      ? "every agent"
                      : r.agent_ids
                          .map((id) => agents.find((a) => a.id === id)?.name ?? "unknown agent")
                          .join(", ")}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggle(r)}
                    disabled={busy === r.id}
                    className="underline decoration-dotted underline-offset-4 hover:text-foreground"
                  >
                    {r.active ? "Pause" : "Resume"}
                  </button>
                </div>

                {r.last_result && (
                  <div className="text-xs text-muted-foreground">
                    Last run{r.last_sent_on ? ` (${r.last_sent_on})` : ""}: {r.last_result}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
