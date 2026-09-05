"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Reveal } from "@/components/marketing/reveal"
import { DepthField } from "@/components/marketing/depth-field"
import { trackPixel } from "@/lib/pixel"

/**
 * The free scan.
 *
 * Two fields, no account, real posts in about a minute. It is the whole
 * acquisition funnel: an ad promises a stranger they can see who near them is
 * asking for their trade, and this is where that promise is kept or broken.
 *
 * The paywall sits after the value, never before — three real posts in full,
 * then a count of what is behind the ask. That count is the entire argument
 * for going further, which is why the API returns it separately rather than
 * just truncating the list.
 *
 * Two doors out, deliberately. An account is the bigger commitment and gets
 * the better outcome; leaving an email is the smaller one for someone who has
 * known us for ninety seconds. Offering only the account loses everyone not
 * ready for it, and those are the people worth following up with.
 *
 * Every step reports to the pixel, because on day four the only question that
 * matters is which step people stop at — an ad that lied and a product that
 * underdelivered look identical in a click report and are fixed in completely
 * different places.
 *
 * ── On the motion ──────────────────────────────────────────────────────────
 *
 * The lightest use of the /welcome depth system: the opening surfaces in three
 * beats, the depth planes sit behind it, and each result card surfaces as it
 * lands. Nothing moves while someone is typing or reading a post. This page
 * is a tool that happens to be public, and a tool that performs at you is a
 * slower tool.
 */

interface ScanRow {
  id: string
  content: string
  trade: string
  city: string
  region: string | null
  source: string
  posted_at: string | null
  intent_score: number | null
}

interface ScanResult {
  trade: string
  city: string
  total: number
  shown: ScanRow[]
  locked: number
  capped: boolean
  /** The city as the visitor typed it, for the sentence they read back. */
  displayCity: string
}

/**
 * The person a trade category refers to, for the headline.
 *
 * The API answers with a category — "plumbing", "electrical" — because that
 * is what the corpus is keyed on, and it used to be dropped straight into
 * "N people asked for a {trade}". The first sentence a prospect read after
 * their scan was "2 people asked for a plumbing near calgary ab". This is the
 * grammar the category was standing in for.
 */
const PERSON_FOR: Record<string, string> = {
  roofing: "a roofer",
  painting: "a painter",
  plumbing: "a plumber",
  electrical: "an electrician",
  flooring: "a flooring installer",
  landscaping: "a landscaper",
  hvac: "an HVAC tech",
  renovation: "a contractor",
  handyman: "a handyman",
  drywall: "a drywaller",
  fencing: "a fence installer",
  concrete: "a concrete contractor",
  tiling: "a tiler",
}

function personFor(trade: string): string {
  return PERSON_FOR[trade] ?? `a ${trade}`
}

/**
 * "calgary ab" → "Calgary AB"; "north vancouver, bc" → "North Vancouver, BC".
 *
 * This split on the letter "s" for a while (`/s+/`, a lost backslash), which
 * turned "Mississauga" into "Mi I Auga" in the headline. Whitespace, as
 * intended.
 */
function prettyCity(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => (word.length <= 2 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(" ")
}

/**
 * Age, or an honest admission that we do not know it.
 *
 * Search results often carry no date, and the temptation is to show "today"
 * rather than an awkward blank. Age is most of what decides whether a lead is
 * worth answering, so a confident wrong date costs more than an honest gap.
 */
function postedWhen(iso: string | null): string {
  if (!iso) return "date unknown"
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000
  if (!Number.isFinite(hours)) return "date unknown"
  if (hours < 1) return "under an hour ago"
  if (hours < 24) return `${Math.round(hours)} hours ago`
  const days = Math.round(hours / 24)
  if (days === 1) return "yesterday"
  if (days < 31) return `${days} days ago`
  const months = Math.round(days / 30)
  return months === 1 ? "a month ago" : `${months} months ago`
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

  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [captured, setCaptured] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)

  const run = async (e: React.FormEvent) => {
    e.preventDefault()
    setScanning(true)
    setError(null)
    setResult(null)
    setCaptured(false)
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
      // Snapshot the typed city with the result, so the headline keeps
      // matching the list even if the visitor edits the box afterwards.
      setResult({ ...(data as Omit<ScanResult, "displayCity">), displayCity: prettyCity(city) })
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

  const capture = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!result) return
    setSending(true)
    setCaptureError(null)
    try {
      const res = await fetch("/api/scan/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          phone,
          consent,
          trade: result.trade,
          city: result.city,
          results: result.total,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCaptureError(data.error ?? "Could not save that.")
        return
      }
      setCaptured(true)
      trackPixel("scanStarted", { trade: result.trade, city: result.city, captured: true })
    } catch {
      setCaptureError("Could not reach the server. Try again in a moment.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <header className="relative z-10 mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
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

      <main className="mk-stage relative mx-auto max-w-3xl px-6 pb-24">
        <DepthField />
        <div className="relative z-10">
          <Reveal>
            <h1 className="text-balance font-[family-name:var(--font-archivo)] text-[2rem] font-bold leading-[1.12] tracking-tight sm:text-5xl sm:leading-tight">
              Who near you is asking for your trade?
            </h1>
          </Reveal>
          <Reveal as="p" delay={70} className="mt-4 max-w-xl text-lg text-muted-foreground">
            Two questions and we&apos;ll look. No account, no card, and you keep whatever we find.
          </Reveal>

          <Reveal delay={140}>
            <form onSubmit={run} className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end">
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
                  placeholder="Toronto ON"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" variant="brand" size="lg" className="mk-lift" disabled={scanning}>
                {scanning ? "Looking…" : "Show me"}
              </Button>
            </form>
          </Reveal>

          {scanning ? (
            <p className="mt-6 text-sm text-muted-foreground">
              Searching public posts across your area. This takes a few seconds.
            </p>
          ) : null}

          {error ? (
            <p className="mt-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          {result && result.total === 0 ? (
            <section className="mt-12 rounded-xl border border-border bg-card p-6">
              <h2 className="font-[family-name:var(--font-archivo)] text-xl font-bold">
                Nothing public for {result.trade} in {result.displayCity} right now.
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                This free scan reads sources anyone can see without logging in. Plenty of work
                gets asked for inside local Facebook and Nextdoor groups instead, which are
                members-only — and those are the ones worth having.
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                Connect your own account once and we read the groups you&apos;re already in.
              </p>
              <Button variant="brand" className="mk-lift mt-5" nativeButton={false} render={<Link href="/signup" />}>
                Create a free account
              </Button>
            </section>
          ) : null}

          {result && result.total > 0 ? (
            <section className="mt-12">
              <h2 className="font-[family-name:var(--font-archivo)] text-2xl font-bold">
                {result.capped ? `${result.total}+` : result.total}{" "}
                {result.total === 1 ? "person" : "people"} asked for {personFor(result.trade)} near{" "}
                {result.displayCity}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">From the last 90 days.</p>

              <div className="mt-6 flex flex-col gap-3">
                {/* Each post surfaces a beat after the one above it. This is the
                    moment the ad's promise is kept, and it should feel like
                    something arriving rather than a list snapping in. */}
                {result.shown.map((row, i) => (
                  <Reveal
                    as="article"
                    key={row.id}
                    delay={i * 90}
                    className="rounded-xl border border-border bg-card p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {SOURCE_LABEL[row.source] ?? row.source} · {postedWhen(row.posted_at)}
                      </span>
                      {row.intent_score != null ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-brand">
                          <span className="size-1.5 rounded-full bg-brand" aria-hidden />
                          {row.intent_score}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 leading-relaxed">{row.content}</p>
                  </Reveal>
                ))}
              </div>

              {/* The ask. Two doors, and the smaller one is not hidden — someone
                  ninety seconds into knowing us is often not ready for an
                  account, and they are exactly who is worth following up. */}
              <Reveal delay={result.shown.length * 90} className="mt-8 rounded-xl border border-brand/40 bg-brand/5 p-6">
                <h3 className="font-[family-name:var(--font-archivo)] text-lg font-bold">
                  {result.locked > 0
                    ? `${result.locked} more, and the link to every one of them.`
                    : "Want the links to these?"}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  We hold the links back on the free scan. Open an account and you get all of
                  them, a new batch each morning, and a reply drafted in your words — or leave
                  your email and we&apos;ll send this list over.
                </p>

                <div className="mt-6 grid gap-6 sm:grid-cols-2">
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-semibold">Create a free account</p>
                    <p className="text-sm text-muted-foreground">
                      Everything above, plus daily matches and the groups you&apos;re already in.
                    </p>
                    <Button variant="brand" className="mk-lift" nativeButton={false} render={<Link href="/signup" />}>
                      Sign up free
                    </Button>
                  </div>

                  <div className="flex flex-col gap-3 border-t border-border pt-6 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                    {captured ? (
                      <div>
                        {/* Says what happened, not what didn't.
                            This read "On its way… if it doesn't arrive, check
                            spam", which states that an email had been sent. None
                            had: the address is recorded and a person sends the
                            list. So the reader waited, searched their spam
                            folder, found nothing, and concluded the product was
                            broken — on the page paid traffic lands on. */}
                        <p className="text-sm font-semibold">Got it.</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          We&apos;ll send this list to {email}. A person puts it together rather than a
                          robot, so give it a few hours — and it&apos;ll come from floozy.ca.
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Don&apos;t want to wait? Create a free account and the full list is on screen
                          straight away.
                        </p>
                      </div>
                    ) : (
                      <form onSubmit={capture} className="flex flex-col gap-3">
                        <p className="text-sm font-semibold">Or email them to me</p>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="cap-email" className="text-xs">
                            Email
                          </Label>
                          <Input
                            id="cap-email"
                            type="email"
                            placeholder="you@yourcompany.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="cap-phone" className="text-xs">
                            Phone <span className="text-muted-foreground">(optional)</span>
                          </Label>
                          <Input
                            id="cap-phone"
                            type="tel"
                            placeholder="604 555 0134"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                          />
                        </div>

                        {/* Unticked by default and stored separately from the
                            address. Having someone's email is not permission to
                            market to them, and CASL does not treat it as one. */}
                        <label className="flex items-start gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={consent}
                            onChange={(e) => setConsent(e.target.checked)}
                          />
                          <span>
                            You can also send me new matches and occasional product email.
                            Unsubscribe any time.
                          </span>
                        </label>

                        <Button type="submit" variant="outline" disabled={sending}>
                          {sending ? "Sending…" : "Email me these leads"}
                        </Button>

                        {captureError ? (
                          <p className="text-sm text-destructive" role="alert">
                            {captureError}
                          </p>
                        ) : null}
                      </form>
                    )}
                  </div>
                </div>
              </Reveal>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  )
}
