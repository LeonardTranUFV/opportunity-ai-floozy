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
const SESSION_SECONDS = 600

export function CloudConnect() {
  const router = useRouter()
  const [starting, setStarting] = useState<Platform | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(SESSION_SECONDS)
  const [reattaching, setReattaching] = useState(false)

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
      // Says it is finished, says what happens next, and repeats the security
      // email warning — that email often arrives after this screen, and by then
      // the customer has forgotten it was mentioned.
      setDone(
        `${label(live.platform)} is connected. We can now read the groups you're already in — ` +
          `add another account any time. If ${label(live.platform)} emails you about a new-device ` +
          `login, that was us: ignore it, and don't press "This wasn't me".`
      )
      setLive(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the server.")
    } finally {
      setSaving(false)
    }
  }

  /**
   * Re-point the viewer at a browser that is still running.
   *
   * Deliberately not automatic on a timer: the iframe reloads when its src
   * changes, and silently reloading the screen underneath somebody halfway
   * through typing a password would be its own bug. They press this when the
   * picture has stopped moving, which is the moment they actually know.
   */
  const reattach = async () => {
    if (!live) return
    setReattaching(true)
    setError(null)
    try {
      const res = await fetch("/api/connect/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: live.sessionId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Could not reconnect to that browser.")
        // 410 means the browser really is gone, so stop showing a dead screen.
        if (res.status === 410) setLive(null)
        return
      }
      setLive({ ...live, liveViewUrl: data.liveViewUrl })
    } catch {
      setError("Could not reach the server.")
    } finally {
      setReattaching(false)
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
            Have your phone within reach before you start — you&apos;ll need it for the code.
          </p>

          {/*
            Said before they log in, not after.

            A real connect produced a Facebook email headed "Security alert:
            login near Atlanta on a new device". It is expected — the login
            genuinely is on a different machine — but it arrives looking
            alarming, and the button on it says "This wasn't me". Pressing that
            invalidates the session we just stored and can lock the account.

            So the warning belongs here, where it is reassurance, rather than
            after, where it would be damage control.
          */}
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            {label(live.platform)} will email you a security alert about a login from a new
            device, possibly in another city. That&apos;s this browser, and it&apos;s expected —
            you can ignore it. <strong>Do not press &ldquo;This wasn&apos;t me&rdquo;</strong>, or
            it will disconnect the account you just linked.
          </p>
        </div>

        {/*
          On a phone the embedded frame is not worth having.

          The remote browser is a 1280px desktop Chrome. Squeezed into a phone
          the result is a viewport the customer has to pan around to find a
          password field, and typing a 2FA code into it is miserable — on the
          device most contractors will actually be using.

          So below `sm` the frame is not rendered at all and the login opens as
          its own full-screen tab instead. That is the same cloud browser, just
          given the whole screen. The session keeps running while they are away,
          so "I've finished logging in" still works when they come back.
        */}
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:hidden">
          <p className="text-sm font-medium">Open the login window</p>
          <p className="text-sm text-muted-foreground">
            It opens in a new tab so you get the full screen. Sign in there, then come back
            here and press <strong>I&apos;ve finished logging in</strong>.
          </p>
          <Button
            variant="brand"
            onClick={() => window.open(live.liveViewUrl, "_blank", "noopener,noreferrer")}
          >
            Open {label(live.platform)} login
          </Button>
        </div>

        <div className="hidden overflow-hidden rounded-lg border bg-black sm:block">
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
            {/* Not "saving your login" — that reads as though we are keeping
                the password, which is the one thing this flow never does. What
                is stored is the session the login left behind. */}
            {saving ? "Connecting your account…" : "I've finished logging in"}
          </Button>
          {/*
            The recovery that was missing.

            The provider's own records show browsers alive for their full five
            minutes while the customer watched a frozen picture: the viewer
            stops following when the page navigates, which on a login flow is
            the exact moment credentials are submitted and the site moves to
            2FA. Before this, the only way out was starting over — throwing
            away a login that had already worked.
          */}
          <Button variant="outline" disabled={saving || reattaching} onClick={reattach}>
            {reattaching ? "Reconnecting…" : "Screen frozen? Reconnect"}
          </Button>
          {/*
            Same cloud browser, bigger window.

            Not an alternative to the cloud browser — logging into Facebook in
            the customer's *own* browser would leave the session in their
            browser, where we cannot reach it, and holding that session is the
            entire point. This opens the same remote session at a usable size,
            which matters most on the screen a 2FA code is hardest to type
            into.
          */}
          {/* Hidden below `sm`, where the mobile card above already offers
              this as the primary action rather than a fallback. */}
          <Button
            variant="outline"
            className="hidden sm:inline-flex"
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

      {/*
        Why this is being asked for, before it is asked for.

        A stranger is about to type a Facebook password into a window on
        somebody else's website. Every question they have at that moment —
        what is this for, what do you keep, is this safe, can I use a
        different account — is answered here rather than left for them to
        guess at. Unanswered, the honest reading of this screen is "phishing".
      */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm font-medium">Why we ask for this</p>
        <p className="text-sm text-muted-foreground">
          The jobs worth having get posted inside local groups — someone asking for a roofer
          in a neighbourhood page nobody outside it can read. Connecting your account lets us
          watch the groups <em>you are already in</em>, score every post for real buying
          intent, and draft you a reply in your own words. Without it we can only see what is
          public, which is a fraction of the work.
        </p>

        <p className="mt-1 text-sm font-medium">What we never touch</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>
            Your password is typed into the platform&apos;s own login page, not ours. We never
            see it, store it, or send it anywhere.
          </li>
          <li>We only read. Nothing is posted, messaged, liked or changed on your account.</li>
          <li>You can disconnect at any time, and every message to a lead is sent by you.</li>
        </ul>

        <p className="mt-1 text-sm font-medium">Two things to expect</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>
            The platform will email you about a login from a new device, possibly in another
            city. That is this browser, and it is expected — ignore it, and do not press
            &ldquo;This wasn&apos;t me&rdquo;, which would disconnect the account again.
          </li>
          <li>
            Happier using a second account than your main one? That works fine — it only needs
            to be a member of the groups you want watched.
          </li>
        </ul>
      </div>

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
