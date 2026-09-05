"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

/**
 * Blocks the app until the current terms are accepted.
 *
 * Shown to anyone whose recorded terms version isn't the current one — which
 * is both new accounts and every existing account after the terms change, so
 * there is no cohort still operating under wording they never saw.
 *
 * The two checkboxes are deliberately separate and the pool one is unticked by
 * default. Bundling "I accept the terms" with "share my leads" into a single
 * box is exactly what makes a consent worthless, and the pool is the part that
 * lets another business act on a lead this user's agent found — so it has to
 * be a choice they actively make, not one they fail to notice.
 */
/**
  * `returning` separates the two reasons this gate appears.
  *
  * It shows whenever the accepted terms version isn't the current one — which
  * is true both for somebody who has never accepted anything and for somebody
  * whose acceptance predates a revision. The component could not tell those
  * apart, so it greeted every new signup with "We've updated our Terms and
  * Privacy Policy", implying they had agreed to something before. On the first
  * screen after signing up, that is the wrong sentence and a slightly
  * dishonest one.
  */
export function ConsentGate({
  poolAlreadyOn,
  returning,
}: {
  poolAlreadyOn: boolean
  returning: boolean
}) {
  const router = useRouter()
  const [accepted, setAccepted] = useState(false)
  const [pool, setPool] = useState(poolAlreadyOn)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSaving(true)
    setError(null)
    const res = await fetch("/api/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accepted, poolOptIn: pool }),
    })
    setSaving(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? "Could not save. Please try again.")
      return
    }
    router.refresh()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl">
        <h2 className="font-[family-name:var(--font-archivo)] text-xl font-bold">
          {returning ? "Before you continue" : "Before you start"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {returning
            ? "We've updated our Terms and Privacy Policy. Please read and accept them to keep using Opportunity AI."
            : "Please read and accept our Terms and Privacy Policy. Here's what matters most, in plain language."}
        </p>

        <div className="mt-5 space-y-3 rounded-lg border border-border bg-accent/40 p-4 text-sm">
          <p className="font-semibold">The short version:</p>
          <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
            <li>
              The service reads communities <strong>you have already joined</strong>, using your own
              connected accounts, as if you were reading them yourself.
            </li>
            <li>
              Those platforms have their own terms. Automated access may breach them, and{" "}
              <strong>your account there is your risk</strong> — we can&apos;t restore an account we
              don&apos;t operate.
            </li>
            <li>
              You decide whether any message is sent. Nothing goes out on its own.
            </li>
          </ul>
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand,#2F6FFF)]"
          />
          <span>
            I have read and accept the{" "}
            <Link href="/terms" target="_blank" className="underline decoration-dotted underline-offset-4">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" className="underline decoration-dotted underline-offset-4">
              Privacy Policy
            </Link>
            , including that my use of connected platforms is at my own risk.{" "}
            <span className="text-muted-foreground">(required)</span>
          </span>
        </label>

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <input
            type="checkbox"
            checked={pool}
            onChange={(e) => setPool(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand,#2F6FFF)]"
          />
          <span>
            <strong>Join the Shared Opportunity Pool.</strong>{" "}
            <span className="text-muted-foreground">(optional — you can change this any time)</span>
            <span className="mt-1 block text-muted-foreground">
              Opportunities your agents find become readable by us and a limited number of authorised
              accounts, who may contact those people — including businesses that compete with you. In
              return the pool covers communities your own account can&apos;t reach.
            </span>
          </span>
        </label>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <Button
          variant="brand"
          className="mt-5 w-full"
          disabled={!accepted || saving}
          onClick={submit}
        >
          {saving ? "Saving…" : "Accept and continue"}
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Don&apos;t agree?{" "}
          <Link href="/auth/signout" className="underline decoration-dotted underline-offset-4">
            Sign out
          </Link>
        </p>
      </div>
    </div>
  )
}
