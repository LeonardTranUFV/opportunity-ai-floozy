"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FacebookIcon, LinkedInIcon, NextdoorIcon, XIcon } from "@/components/icons"

/**
 * Self-serve connect for hosted customers.
 *
 * The browser being shown in the iframe is not running here — it is running at
 * the provider, and only its screen is streamed. That is what lets somebody on
 * app.floozy.ca log into Facebook for our crawler at all: the login happens in
 * a real browser with a real IP, and the page they type their password into is
 * genuinely Facebook's, served to that browser rather than reproduced by us.
 *
 * We never see the password. What we keep is the session the login leaves
 * behind, captured server-side by /api/connect/finish.
 */

type Platform = "facebook" | "linkedin" | "nextdoor" | "twitter"

const PLATFORMS: { id: Platform; label: string; Icon: typeof FacebookIcon }[] = [
  { id: "facebook", label: "Facebook", Icon: FacebookIcon },
  { id: "linkedin", label: "LinkedIn", Icon: LinkedInIcon },
  { id: "nextdoor", label: "Nextdoor", Icon: NextdoorIcon },
  { id: "twitter", label: "X", Icon: XIcon },
]

type Live = { sessionId: string; liveViewUrl: string; platform: Platform }

/**
 * How long the cloud browser lives before the provider reclaims it.
 *
 * Must match DEFAULT_IDLE_TIMEOUT_SECONDS in lib/remote-browser-browserbase.ts,
 * which is 300 because the free tier rejects anything larger at creation.
 *
 * Shown to the customer rather than left implicit, because the failure it
 * causes is silent and looks like a bug in us. The provider's own session log
 * is unambiguous: every long connect attempt ended at 303, 307, 309 or 310
 * seconds — the cap, every time. Someone part-way through a 2FA code watched
 * the window freeze with no way to know a clock had run out. A visible
 * countdown turns "this is broken" into "I need to hurry", which is a
 * completely different experience of the same limit.
 *
 * The real fix is a plan that allows a longer session; this makes the
 * constraint honest until then.
 */
const SESSION_SECONDS = 300

export function CloudConnect() {
  const router = useRouter()
  const [starting, setStarting] = useState<Platform | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(SESSION_SECONDS)

  const label = (id: Platform) => PLATFORMS.find((p) => p.id === id)?.label ?? id

  const start = async (platform: Platform) => {
    setStarting(platform)
    setError(null)
    setDone(null)
    try {
      const res = await fetch("/api/connect/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Could not start a browser.")
        return
      }
      setRemaining(SESSION_SECONDS)
      setLive({ sessionId: data.sessionId, liveViewUrl: data.liveViewUrl, platform })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the server.")
    } finally {
      setStarting(null)
    }
  }

  const finish = async () => {
    if (!live) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/connect/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: live.sessionId }),
      })
      const data = await res.json()
      if (!res.ok) {
        // 409 means "you are not signed in yet" — the browser is still alive
        // and still on screen, so keep it there and let them carry on. Tearing
        // the iframe down on that would make a recoverable mistake look like a
        // failure and cost them the whole login.
        setError(data.error ?? "Could not save that login.")
        if (res.status !== 409) setLive(null)
        return
      }
      setDone(`${label(live.platform)} connected. The crawler can now read on your behalf.`)
      setLive(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the server.")
    } finally {
      setSaving(false)
    }
  }

  /**
   * Abandoning the flow has to release the browser, or it bills until its idle
   * timeout. Best-effort: keepalive lets the request outlive the page during
   * an unload, and the provider's timeout is the backstop when even that
   * fails.
   */
  const cancel = useCallback((sessionId: string) => {
    void fetch("/api/connect/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
      keepalive: true,
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!live) return
    const sessionId = live.sessionId
    const onUnload = () => cancel(sessionId)
    window.addEventListener("pagehide", onUnload)
    return () => window.removeEventListener("pagehide", onUnload)
  }, [live, cancel])

  // Counts down the provider's session cap.
  //
  // The clock starts here rather than in the click handler because reading
  // Date.now() during render is impure — the same component re-rendering would
  // silently restart the timer. An effect is where a side effect belongs, and
  // it runs immediately after the session is set, so the two are the same
  // moment for practical purposes.
  //
  // Each tick recomputes from that captured start rather than decrementing, so
  // a backgrounded tab — where browsers throttle timers — still shows the true
  // remaining time when the customer comes back to it.
  useEffect(() => {
    if (!live) return
    const startedAt = Date.now()
    const tick = () =>
      setRemaining(Math.max(0, SESSION_SECONDS - Math.floor((Date.now() - startedAt) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [live])

  if (live) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">Log into {label(live.platform)} below</h3>

            {/* The constraint, said out loud. Under 90 seconds it turns amber:
                that is roughly the point past which starting to hunt for a 2FA
                code will not finish in time, and knowing that beats watching
                the window freeze for no visible reason. */}
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${
                remaining === 0
                  ? "bg-destructive/10 text-destructive"
                  : remaining < 90
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {remaining === 0
                ? "Session expired — start again"
                : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} left`}
            </span>
          </div>

          <p className="text-sm text-muted-foreground">
            This is a real browser running in the cloud. Sign in as you normally would, including any
            2FA code. Nobody here can see what you type — when you&apos;re done, use the button
            underneath.
          </p>
          <p className="text-sm font-medium">
            Have your phone within reach before you start. The browser is only held for five
            minutes, and if it runs out mid-login the window freezes and you begin again.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border bg-black">
          {/*
            The sandbox Browserbase documents for embedding a live view, and
            allow-same-origin is load-bearing rather than lax.

            Without it the framed document is forced into an *opaque* origin, so
            its WebSocket back to the provider cannot connect. That is not a
            visible error — the frame loads and then renders a black rectangle
            forever, which is exactly how the first live attempt failed.

            It does not give the frame access to this page. The live view is
            served from the provider's origin, not ours, so same-origin policy
            already separates the two; allow-same-origin only lets the frame
            keep its own true origin instead of being anonymised. The
            combination that genuinely defeats a sandbox is allow-same-origin
            plus allow-scripts on content served from *our own* origin, which
            could then rewrite its own sandbox attribute and escape. This frame
            is cross-origin, so that does not apply.

            Left off deliberately: allow-top-navigation, so a framed page can
            never move the customer off this one, and allow-modals.
          */}
          <iframe
            src={live.liveViewUrl}
            title={`${label(live.platform)} login`}
            className="h-[600px] w-full"
            sandbox="allow-same-origin allow-scripts"
            allow="clipboard-read; clipboard-write"
          />
        </div>

        {error && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button variant="brand" onClick={finish} disabled={saving}>
            {saving ? "Saving your login…" : "I've finished logging in"}
          </Button>
          {/*
            Same cloud browser, bigger window.

            Not an alternative to the cloud browser — logging into Facebook in
            the customer's *own* browser would leave the session in their
            browser, where we cannot reach it, and the whole point is that we
            end up holding it. This opens the same remote session at a usable
            size, which matters most on the screen it is hardest to type a 2FA
            code into.

            The session keeps running either way, so "I've finished logging in"
            below still works once they come back.
          */}
          <Button
            variant="outline"
            disabled={saving}
            onClick={() =>
              window.open(
                live.liveViewUrl,
                "opportunity-ai-connect",
                "width=1100,height=850,noopener,noreferrer"
              )
            }
          >
            Open in a bigger window
          </Button>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => {
              cancel(live.sessionId)
              setLive(null)
              setError(null)
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {done && (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {done}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {PLATFORMS.map(({ id, label: name, Icon }) => (
          <Button
            key={id}
            variant="outline"
            className="justify-start gap-3"
            disabled={starting !== null}
            onClick={() => start(id)}
          >
            <Icon className="h-4 w-4" />
            {starting === id ? `Starting a browser…` : `Connect ${name}`}
          </Button>
        ))}
      </div>
    </div>
  )
}
