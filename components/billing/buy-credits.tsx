"use client"

import { useState } from "react"
import { CreditCard, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PACK_SIZES, formatCad, type PackSize } from "@/lib/credit-packs"
import { readApiError, CONNECTION_ERROR } from "@/lib/format-error"
import { cn } from "@/lib/utils"

/**
 * The pack picker. Five sizes as buttons rather than a free number field:
 * the sizes are what the API accepts, and a field invites "how many can I
 * type" instead of "which one do I want".
 *
 * The rate is the customer's own plan's rate, passed in from the server so
 * this component never has to know how plans map to prices.
 */
export function BuyCredits({
  centsPerCredit,
  planLabel,
  enabled,
}: {
  centsPerCredit: number
  planLabel: string
  enabled: boolean
}) {
  const [size, setSize] = useState<PackSize>(500)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = size * centsPerCredit

  const buy = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credits: size }),
      })
      if (!res.ok) {
        setError(await readApiError(res, "Couldn't start checkout."))
        return
      }
      const { url } = (await res.json()) as { url: string }
      window.location.assign(url)
    } catch {
      setError(CONNECTION_ERROR)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {PACK_SIZES.map((n) => {
          const selected = n === size
          return (
            <button
              key={n}
              type="button"
              onClick={() => setSize(n)}
              aria-pressed={selected}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center rounded-lg border px-2 py-2 text-sm transition-colors",
                selected
                  ? "border-brand bg-brand/10 text-foreground ring-1 ring-brand"
                  : "border-border bg-card text-muted-foreground hover:bg-muted"
              )}
            >
              <span className="font-heading text-lg font-semibold tabular-nums text-foreground">{n}</span>
              <span className="text-xs tabular-nums">{formatCad(n * centsPerCredit)}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <div className="font-medium">
            {size} credits · {formatCad(total)}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatCad(centsPerCredit)} per credit on the {planLabel} plan. One-off, never expires, added the
            moment payment clears.
          </div>
        </div>
        <Button variant="brand" onClick={buy} disabled={!enabled || busy} className="sm:shrink-0">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
          {busy ? "Opening checkout…" : `Buy ${size} credits`}
        </Button>
      </div>

      {!enabled && (
        <p className="text-xs text-muted-foreground">
          Credit packs aren&apos;t switched on for this deployment yet. Upgrading your plan still works.
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
