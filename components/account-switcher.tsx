"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown, Eye, Loader2, Search, Undo2 } from "lucide-react"
import type { Switcher } from "@/lib/account-switch"
import { cn } from "@/lib/utils"

const DOT_COLORS = ["#2457F5", "#E11D48", "#059669", "#D97706", "#7C3AED", "#0891B2", "#DB2777", "#EA580C"]

/** One steady colour per account, so a client is recognisable at a glance. */
function dotColor(id: string): string {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return DOT_COLORS[hash % DOT_COLORS.length]
}

/**
 * A full page load, not a router refresh: nothing cached from the last account
 * can leak into the next one. Returns an error to show, or null when leaving.
 */
async function switchTo(userId: string): Promise<string | null> {
  try {
    const res = await fetch("/api/admin/switch-account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    })
    const body = await res.json().catch(() => ({}))
    if (body.expired) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full load on purpose, see above
      window.location.href = "/login"
      return null
    }
    if (!res.ok || !body.success) return body.error ?? "Could not switch accounts."
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full load on purpose, see above
    window.location.href = "/"
    return null
  } catch {
    return "Could not switch accounts. Check your connection."
  }
}

export function AccountSwitcher({ switcher }: { switcher: Switcher }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const current = switcher.accounts.find((a) => a.id === switcher.currentId)
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return switcher.accounts
    return switcher.accounts.filter(
      (a) => a.label.toLowerCase().includes(needle) || a.email.toLowerCase().includes(needle)
    )
  }, [query, switcher.accounts])

  async function pick(id: string) {
    if (id === switcher.currentId) {
      setOpen(false)
      return
    }
    setBusyId(id)
    setError(null)
    const problem = await switchTo(id)
    if (problem) {
      setError(problem)
      setBusyId(null)
    }
  }

  return (
    <div ref={rootRef} className="relative px-1 group-data-[collapsible=icon]:hidden">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-background/60 px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent"
      >
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: dotColor(switcher.currentId) }} />
        <span className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-sm font-medium">{current?.isOperator ? "My account" : current?.label}</span>
          <span className="truncate text-xs text-muted-foreground">
            {switcher.viewing ? "Client account" : "Switch to a client"}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute inset-x-1 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
        >
          {switcher.accounts.length > 8 && (
            <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
              <Search className="size-3.5 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find an account"
                aria-label="Find an account"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <div className="max-h-72 overflow-y-auto p-1">
            {visible.map((account) => {
              const isCurrent = account.id === switcher.currentId
              return (
                <button
                  key={account.id}
                  type="button"
                  role="menuitem"
                  disabled={busyId !== null}
                  onClick={() => pick(account.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted disabled:opacity-60",
                    isCurrent && "bg-muted/60"
                  )}
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: dotColor(account.id) }} />
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate text-sm">{account.isOperator ? "My account" : account.label}</span>
                    <span className="truncate text-xs text-muted-foreground">{account.email}</span>
                  </span>
                  {busyId === account.id ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : isCurrent ? (
                    <Check className="size-4 shrink-0 text-brand" />
                  ) : null}
                </button>
              )
            })}
            {visible.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">No account matches that.</p>
            )}
          </div>
          {error && <p role="alert" className="border-t border-border px-2.5 py-2 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}

export function SwitchBanner({ switcher }: { switcher: Switcher }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!switcher.viewing) return null

  async function goBack() {
    setBusy(true)
    setError(null)
    const problem = await switchTo(switcher.operatorId)
    if (problem) {
      setError(problem)
      setBusy(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 bg-amber-400 px-4 py-2 text-sm text-amber-950">
      <Eye className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        You&apos;re in <strong className="font-semibold">{switcher.viewing.label}</strong>&apos;s account.{" "}
        {switcher.expired
          ? "This switch has expired, so you'll need to sign in again."
          : "What you do here is real. Payments and accepting terms are blocked."}
        {error && <span className="ml-2 font-medium">{error}</span>}
      </p>
      <button
        type="button"
        onClick={goBack}
        disabled={busy}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-950 px-3 py-1 text-xs font-medium text-amber-50 transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
        Back to my account
      </button>
    </div>
  )
}
