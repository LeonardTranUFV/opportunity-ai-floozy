"use client"

import { useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Gem, ChevronDown, ChevronUp, CreditCard, Radar, PenLine, Sparkles, Wand2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDateTime } from "@/lib/format-date"

export interface CreditTx {
  id: string
  amount: number
  reason: string
  balance_after: number
  created_at: string
  metadata: Record<string, unknown> | null
}

const PREVIEW = 8

/** Per-action presentation. Keys match the `reason` written by lib/credits.ts. */
const ACTIONS: Record<string, { label: string; icon: typeof Radar; tone: string }> = {
  scan_batch: { label: "Post scan", icon: Radar, tone: "text-emerald-600 dark:text-emerald-400" },
  draft_generation: { label: "Outreach draft", icon: PenLine, tone: "text-violet-600 dark:text-violet-400" },
  agent_setup: { label: "AI agent setup", icon: Wand2, tone: "text-cyan-600 dark:text-cyan-400" },
  group_recommendations: { label: "Group suggestions", icon: Sparkles, tone: "text-fuchsia-600 dark:text-fuchsia-400" },
  admin_grant: { label: "Credits added", icon: Gem, tone: "text-emerald-600 dark:text-emerald-400" },
  admin_deduct: { label: "Credits removed", icon: Gem, tone: "text-rose-600 dark:text-rose-400" },
  monthly_allowance: { label: "Monthly allowance", icon: Gem, tone: "text-emerald-600 dark:text-emerald-400" },
  top_up_purchase: { label: "Credit pack purchased", icon: CreditCard, tone: "text-emerald-600 dark:text-emerald-400" },
}

function actionFor(reason: string) {
  return ACTIONS[reason] ?? { label: reason.replace(/_/g, " "), icon: Gem, tone: "text-muted-foreground" }
}

/** Turns the transaction's metadata into a short human line: what it was spent on. */
function detailFor(tx: CreditTx): string | null {
  const m = tx.metadata ?? {}
  const s = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : null)
  const n = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : null)

  switch (tx.reason) {
    case "scan_batch": {
      const size = n("batch_size")
      return size ? `Evaluated ${size} post${size === 1 ? "" : "s"}` : null
    }
    case "group_recommendations": {
      const trade = s("trade")
      const loc = s("location")
      const got = n("returned")
      const who = [trade, loc].filter(Boolean).join(" · ")
      return who ? `${who}${got ? ` — ${got} suggestions` : ""}` : null
    }
    case "admin_grant":
    case "admin_deduct":
      return s("note")
    default:
      return null
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return formatDateTime(d)
}

export function CreditsPanel({
  balance,
  allowance,
  plan,
  transactions,
}: {
  balance: number | null
  allowance: number | null
  plan: string | null
  transactions: CreditTx[]
}) {
  const [expanded, setExpanded] = useState(false)

  const spends = transactions.filter((t) => t.amount < 0)
  const totalUsed = spends.reduce((sum, t) => sum + Math.abs(t.amount), 0)

  // Credits spent grouped by what they were spent on — the "what did my
  // credits actually go to" question the raw ledger doesn't answer at a glance.
  const byAction = new Map<string, { credits: number; count: number }>()
  for (const t of spends) {
    const cur = byAction.get(t.reason) ?? { credits: 0, count: 0 }
    cur.credits += Math.abs(t.amount)
    cur.count += 1
    byAction.set(t.reason, cur)
  }
  const breakdown = [...byAction.entries()].sort((a, b) => b[1].credits - a[1].credits)

  // A plan's credits arrive as "plan_grant:<plan>:<period>" once per billing
  // period. Matching only top-ups meant every subscriber read "No payments
  // yet" under a balance their subscription had just funded.
  const lastPayment = transactions.find(
    (t) => t.reason === "top_up_purchase" || t.reason.startsWith("plan_grant:")
  )
  const visible = expanded ? transactions : transactions.slice(0, PREVIEW)

  return (
    <div className="flex flex-col gap-5">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-border p-3">
          <div className="font-heading text-2xl font-semibold tabular-nums">{balance ?? "—"}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Credits remaining</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="font-heading text-2xl font-semibold tabular-nums">{totalUsed}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Credits used</div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="font-heading text-2xl font-semibold capitalize">{plan ?? "—"}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {allowance ? `${allowance}/mo allowance` : "Current plan"}
          </div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="font-heading text-2xl font-semibold">
            {lastPayment ? formatWhen(lastPayment.created_at) : "—"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {lastPayment ? "Last plan credit" : "No plan yet"}
          </div>
        </div>
      </div>

      {!lastPayment && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          No plan on this account yet — you&apos;re on trial credits. Plans start with a 3-day free trial; see the{" "}
          <Link href="/pricing" className="text-brand underline decoration-dotted underline-offset-4">
            pricing page
          </Link>
          .
        </p>
      )}

      {/* What credits went to */}
      {breakdown.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium">What your credits went to</h4>
          {breakdown.map(([reason, stat]) => {
            const { label, icon: Icon, tone } = actionFor(reason)
            const pct = totalUsed > 0 ? (stat.credits / totalUsed) * 100 : 0
            return (
              <div key={reason} className="flex items-center gap-3 text-sm">
                <Icon className={cn("size-4 shrink-0", tone)} />
                <span className="w-36 shrink-0 truncate">{label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(pct, 3)}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {stat.credits} cr · {stat.count}×
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Full ledger */}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">Transaction history</h4>
        {transactions.length === 0 ? (
          <EmptyState
            icon={Gem}
            title="No credit activity yet"
            description="Scans, drafts and group suggestions will appear here as they happen."
          />
        ) : (
          <>
            <div className="flex flex-col divide-y divide-border">
              {visible.map((tx) => {
                const { label, icon: Icon, tone } = actionFor(tx.reason)
                const detail = detailFor(tx)
                const spent = tx.amount < 0
                return (
                  <div key={tx.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Icon className={cn("size-4 shrink-0", tone)} />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{label}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {formatWhen(tx.created_at)}
                          {detail ? ` · ${detail}` : ""}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge variant="outline" className="tabular-nums">
                        {tx.balance_after} left
                      </Badge>
                      <span
                        className={cn(
                          "w-10 text-right font-medium tabular-nums",
                          spent ? "text-foreground" : "text-emerald-600 dark:text-emerald-400"
                        )}
                      >
                        {spent ? tx.amount : `+${tx.amount}`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
            {transactions.length > PREVIEW && (
              <Button
                variant="ghost"
                size="sm"
                className="w-fit text-muted-foreground"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" />
                    Show all {transactions.length}
                  </>
                )}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
