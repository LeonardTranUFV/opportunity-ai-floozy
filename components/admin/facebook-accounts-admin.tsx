"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CloudConnect } from "@/components/accounts/cloud-connect"
import { GROUP_REQUEST_STATUS_LABEL, type GroupRequestStatus } from "@/lib/group-requests"

export type AdminCollector = {
  id: string
  label: string
  login: "active" | "expired" | "revoked" | "none"
  lastVerifiedAt: string | null
  groups: number
}

export type AdminRequest = {
  id: string
  url: string
  name: string | null
  note: string | null
  status: GroupRequestStatus
  collectorId: string | null
  client: string
  clientEmail: string
  clientAreaId: string | null
  createdAt: string
}

const LOGIN_LABEL: Record<AdminCollector["login"], string> = {
  active: "Signed in",
  expired: "Needs signing in again",
  revoked: "Signed out",
  none: "Not signed in yet",
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" })

function Picker({
  value,
  onChange,
  options,
  placeholder,
  label,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder: string
  label: string
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(String(next ?? ""))}>
      <SelectTrigger className="w-full min-w-0" aria-label={label}>
        <SelectValue>{(v: string) => options.find((o) => o.value === v)?.label ?? placeholder}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RequestRow({
  request,
  collectors,
  areas,
}: {
  request: AdminRequest
  collectors: AdminCollector[]
  areas: { value: string; label: string }[]
}) {
  const router = useRouter()
  const [collectorId, setCollectorId] = useState(request.collectorId ?? "")
  const [areaId, setAreaId] = useState(request.clientAreaId ?? "")
  const [access, setAccess] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/group-requests/${request.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Could not update that request.")
        return
      }
      router.refresh()
    } catch {
      setError("Could not reach the server.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-sm font-medium">{request.client}</span>
          <span className="truncate text-xs text-muted-foreground">
            {request.clientEmail} · asked {shortDate(request.createdAt)}
          </span>
          <a href={request.url} target="_blank" rel="noreferrer" className="truncate text-sm text-brand underline-offset-2 hover:underline">
            {request.name ?? request.url}
          </a>
          {request.note && <p className="text-sm text-muted-foreground">{request.note}</p>}
        </div>
        <Badge variant="outline">{GROUP_REQUEST_STATUS_LABEL[request.status]}</Badge>
      </div>

      {request.status !== "active" && request.status !== "declined" && (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Picker
              label="Floozy Facebook account"
              placeholder="Which account joins?"
              value={collectorId}
              onChange={setCollectorId}
              options={collectors.map((c) => ({ value: c.id, label: c.label }))}
            />
            <Picker label="Area" placeholder="Which area?" value={areaId} onChange={setAreaId} options={areas} />
            <Picker
              label="Group privacy"
              placeholder="Public or private?"
              value={access}
              onChange={setAccess}
              options={[
                { value: "public", label: "Public" },
                { value: "private", label: "Private" },
              ]}
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {request.status === "requested" && (
              <Button variant="outline" disabled={busy} onClick={() => send({ action: "joining", collectorId })}>
                We&apos;re joining
              </Button>
            )}
            <Button variant="brand" disabled={busy} onClick={() => send({ action: "activate", collectorId, areaId, access })}>
              Joined, start collecting
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => send({ action: "decline" })}>
              Decline
            </Button>
          </div>
        </>
      )}
    </li>
  )
}

export function FacebookAccountsAdmin({
  collectors,
  requests,
  areas,
  canConnect,
}: {
  collectors: AdminCollector[]
  requests: AdminRequest[]
  areas: { value: string; label: string }[]
  canConnect: boolean
}) {
  const router = useRouter()
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<AdminCollector | null>(null)

  async function addAccount(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/facebook-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Could not add that account.")
        return
      }
      setLabel("")
      router.refresh()
    } catch {
      setError("Could not reach the server.")
    } finally {
      setBusy(false)
    }
  }

  const open = requests.filter((r) => r.status === "requested" || r.status === "joining")
  const closed = requests.filter((r) => r.status === "active" || r.status === "declined")

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Client group requests {open.length > 0 && <Badge className="ml-1">{open.length}</Badge>}</CardTitle>
          <CardDescription>
            Join the group on Facebook with one of your accounts first, then press Joined so collection can start.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing waiting. New requests show here and are emailed to admins.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {open.map((request) => (
                <RequestRow key={request.id} request={request} collectors={collectors} areas={areas} />
              ))}
            </ul>
          )}
          {closed.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Finished requests ({closed.length})</summary>
              <ul className="mt-3 flex flex-col gap-3">
                {closed.map((request) => (
                  <RequestRow key={request.id} request={request} collectors={collectors} areas={areas} />
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Floozy Facebook accounts</CardTitle>
          <CardDescription>
            Accounts your team owns for reading groups, so client accounts are never used. Sign in to each one here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {collectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts yet. Add your first one below.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {collectors.map((collector) => (
                <li key={collector.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
                  <div className="grid min-w-0 gap-0.5">
                    <span className="truncate text-sm font-medium">{collector.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {collector.groups} group{collector.groups === 1 ? "" : "s"}
                      {collector.lastVerifiedAt ? ` · checked ${shortDate(collector.lastVerifiedAt)}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={collector.login === "active" ? "secondary" : "outline"}>{LOGIN_LABEL[collector.login]}</Badge>
                    <Button variant="outline" disabled={!canConnect} onClick={() => setConnecting(collector)}>
                      {collector.login === "active" ? "Sign in again" : "Sign in"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={addAccount} className="flex flex-wrap gap-2">
            <Input
              required
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Account name, e.g. Floozy Vancouver 1"
              aria-label="New account name"
              maxLength={80}
              className="min-w-0 flex-1 basis-56"
            />
            <Button type="submit" variant="brand" disabled={busy}>
              {busy ? "Adding…" : "Add account"}
            </Button>
          </form>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {!canConnect && (
            <p className="text-sm text-muted-foreground">Signing in needs the cloud browser, which isn&apos;t set up on this deployment.</p>
          )}
        </CardContent>
      </Card>

      {connecting && (
        <Card>
          <CardHeader>
            <CardTitle>Sign in: {connecting.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <CloudConnect key={connecting.id} collector={{ id: connecting.id, label: connecting.label }} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
