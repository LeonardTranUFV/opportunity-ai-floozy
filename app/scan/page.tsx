"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { trackPixel } from "@/lib/pixel"

/**
 * The free scan.
 *
 * Two fields, no account, real posts in under a minute. It is the whole
 * acquisition funnel: an ad promises a stranger they can see who near them is
 * asking for their trade, and this is where that promise is either kept or
 * broken. Everything about it is arranged around getting to a result before
 * anyone is asked for anything.
 *
 * The paywall sits after the value, never before — three real posts in full,
 * then a count of what is behind the trial. That count is the entire argument
 * for paying, which is why the API returns it separately rather than just
 * truncating the list.
 *
 * Every step reports to the pixel, because on day four the only question that
 * matters is which step people stop at: an ad that lied looks completely
 * different from a product that underdelivered, and they are fixed in
 * different places.
 */

interface ScanRow {
  id: string
  content: string
  trade: string
  city: string
  region: string | null
  source: string
  posted_at: string
  intent_score: number | null
}

interface ScanResult {
  trade: string
  city: string
  total: number
  shown: ScanRow[]
  locked: number
  capped: boolean
}

function howLongAgo(iso: string): string {
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes ago`
  if (hours < 24) return `${Math.round(hours)} hours ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "yesterday" : `${days} days ago`
}

const SOURCE_LABEL: Record<string, string> = {
  reddit: "Reddit",
  web: "Public post",
  craigslist: "Craigslist",
  facebook: "Facebook",
  nextdoor: "Nextdoor",
}

export default function ScanPage() {
  const [trade, setTrade] = useState("")
  const [city, setCity] = useState("")
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (e: React.FormEvent) => {
    e.preventDefault()
    setScanning(true)
    setError(null)
    setResult(null)
    trackPixel("scanStarted", { trade, city })

    try {
      const res = await fetch("/api/scan/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade, city }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Something went wrong looking.")
        return
      }
      setResult(data as ScanResult)
      if (data.total > 0) {
        trackPixel("resultsShown", { trade, city, results: data.total })
        if (data.locked > 0) trackPixel("paywallSeen", { trade, city })
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 shadow-sm shadow-blue-600/30">
            <span className="font-bold text-white">O</span>
          </div>
          <span className="font-semibold">Floozy Opportunity AI</span>
        </Link>
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24">
        <h1 className="text-balance font-[family-name:var(--font-archivo)] text-4xl font-bold tracking-tight sm:text-5xl">
          Who near you is asking for your trade?
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          Two questions and we&apos;ll look. No account, no card, and you keep whatever we find.
        </p>

        <form onSubmit={run} className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="trade">Your trade</Label>
            <Input
              id="trade"
              placeholder="Roofer"
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="city">Your city</Label>
            <Input
              id="city"
              placeholder="Burnaby"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
            />
          </div>
          <Button type="submit" variant="brand" size="lg" disabled={scanning}>
            {scanning ? "Looking…" : "Show me"}
          </Button>
        </form>

        {error ? (
          <p className="mt-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {result ? (
          result.total === 0 ? (
            /* An empty result is a real answer, not a failure — and saying so
               plainly is worth more than a spinner that never resolves. It
               also names the two things that actually cause it. */
            <section className="mt-12 rounded-xl border border-border bg-card p-6">
              <h2 className="font-[family-name:var(--font-archivo)] text-xl font-bold">
                Nothing public for {result.trade} in {result.city} yet.
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                This free scan only reads sources that are public — the ones anyone can see
                without logging in. Most trade work gets asked for inside local Facebook and
                Nextdoor groups, which are members-only.
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                Those are the ones worth having. Connect your own account once and we read the
                groups you&apos;re already in.
              </p>
              <Button
                variant="brand"
                className="mt-5"
                nativeButton={false}
                render={<Link href="/signup" />}
              >
                Create a free account
              </Button>
            </section>
          ) : (
            <section className="mt-12">
              <h2 className="font-[family-name:var(--font-archivo)] text-2xl font-bold">
                {result.capped ? `${result.total}+` : result.total}{" "}
                {result.total === 1 ? "person" : "people"} asked for a {result.trade} near{" "}
                {result.city}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">In the last 90 days.</p>

              <div className="mt-6 flex flex-col gap-3">
                {result.shown.map((row) => (
                  <article key={row.id} className="rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-muted-foreground">
                        {SOURCE_LABEL[row.source] ?? row.source}
                        {row.region ? ` · ${row.region}` : ""} · {howLongAgo(row.posted_at)}
                      </span>
                      {row.intent_score != null ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-brand">
                          <span className="size-1.5 rounded-full bg-brand" aria-hidden />
                          {row.intent_score}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 leading-relaxed">&ldquo;{row.content}&rdquo;</p>
                  </article>
                ))}
              </div>

              {result.locked > 0 ? (
                <div className="mt-6 rounded-xl border border-brand/40 bg-brand/5 p-6">
                  <h3 className="font-[family-name:var(--font-archivo)] text-lg font-bold">
                    {result.locked} more, and a way to reach every one of them.
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    A trial opens the rest, the link to each post, and a daily email when new
                    ones appear. Connect Facebook or Nextdoor and it reads the groups you&apos;re
                    already in too — that&apos;s where most of this work actually gets asked for.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button variant="brand" nativeButton={false} render={<Link href="/signup" />}>
                      See the rest — free account
                    </Button>
                    <Button variant="outline" nativeButton={false} render={<Link href="/pricing" />}>
                      See pricing
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          )
        ) : null}
      </main>
    </div>
  )
}
