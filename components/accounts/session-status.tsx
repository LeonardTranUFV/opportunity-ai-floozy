"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, User } from "lucide-react"
import { FacebookIcon, LinkedInIcon, NextdoorIcon, XIcon } from "@/components/icons"

interface Status {
  source?: string
  facebook: boolean
  facebookName: string | null
  facebookError: string | null
  facebookSince?: string | null
  linkedin: boolean
  linkedinName: string | null
  linkedinError: string | null
  linkedinSince?: string | null
  nextdoor: boolean
  nextdoorName: string | null
  nextdoorError: string | null
  nextdoorSince?: string | null
  twitter: boolean
  twitterName: string | null
  twitterError: string | null
  twitterSince?: string | null
}

function PlatformRow({
  icon,
  label,
  loggedIn,
  name,
  error,
  since,
  iconColor,
}: {
  icon: React.ReactNode
  label: string
  loggedIn: boolean
  name: string | null
  error: string | null
  /** When the login was captured. Present on hosted, where no live check runs. */
  since?: string | null
  iconColor: string
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconColor}`}>{icon}</div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{label}</span>
            {loggedIn && name ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                {name}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {loggedIn
                  ? since
                    ? `Connected ${new Date(since).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
                    : "Logged in"
                  : error
                    ? "Couldn't check"
                    : "Not connected"}
              </span>
            )}
          </div>
        </div>
        <Badge variant={loggedIn ? "success" : error ? "warning" : "secondary"}>
          {loggedIn ? "Connected" : error ? "Check failed" : "Not logged in"}
        </Badge>
      </div>
      {error && (
        <p className="pl-12 text-xs text-amber-600 dark:text-amber-400">
          {error} This is not the same as being logged out — retry the check once that&apos;s resolved.
        </p>
      )}
    </div>
  )
}

/**
 * Which accounts are connected.
 *
 * `autoLoad` is set by the hosted Connect page and nowhere else. There the
 * answer comes from stored sessions and costs a database read, so making
 * somebody press "Check Status" to see it was a click for nothing — and a
 * customer who had just finished connecting Facebook landed on an empty box
 * that read as "it didn't take". Locally the same check drives four real
 * Chrome windows, which is not something to fire on every page view.
 */
async function fetchStatus(): Promise<Status | null> {
  const res = await fetch("/api/accounts/status")
  const data = await res.json()
  if (!res.ok || !data.success) return null
  return {
    source: data.source,
    facebook: data.facebook,
    facebookName: data.facebookName,
    facebookError: data.facebookError,
    facebookSince: data.facebookSince,
    linkedin: data.linkedin,
    linkedinName: data.linkedinName,
    linkedinError: data.linkedinError,
    linkedinSince: data.linkedinSince,
    nextdoor: data.nextdoor,
    nextdoorName: data.nextdoorName,
    nextdoorError: data.nextdoorError,
    nextdoorSince: data.nextdoorSince,
    twitter: data.twitter,
    twitterName: data.twitterName,
    twitterError: data.twitterError,
    twitterSince: data.twitterSince,
  }
}

export function SessionStatus({ autoLoad = false }: { autoLoad?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null)
  // Starts true when auto-loading so the first paint already says
  // "Checking…" rather than flashing the click-to-check prompt first.
  const [checking, setChecking] = useState(autoLoad)

  const handleCheck = useCallback(async () => {
    setChecking(true)
    try {
      const next = await fetchStatus()
      if (next) setStatus(next)
    } finally {
      setChecking(false)
    }
  }, [])

  // State is only set from the fetch's callbacks, never synchronously in the
  // effect body — and a component that unmounts mid-request (navigating away
  // from Connect) must not set state on its way out.
  useEffect(() => {
    if (!autoLoad) return
    let cancelled = false
    fetchStatus()
      .then((next) => {
        if (!cancelled && next) setStatus(next)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [autoLoad])

  // The hosted answer is read from saved connections, not from signing in.
  const stored = status?.source === "stored"

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Session Status</span>
        <Button variant="ghost" size="xs" onClick={handleCheck} disabled={checking}>
          <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Checking…" : "Check Status"}
        </Button>
      </div>

      {status ? (
        <div className="flex flex-col gap-2">
          <PlatformRow
            icon={<FacebookIcon className="h-4.5 w-4.5" />}
            label="Facebook"
            loggedIn={status.facebook}
            name={status.facebookName}
            error={status.facebookError}
            since={status.facebookSince}
            iconColor="bg-[#1877F2]/10 text-[#1877F2]"
          />
          <PlatformRow
            icon={<LinkedInIcon className="h-4.5 w-4.5" />}
            label="LinkedIn"
            loggedIn={status.linkedin}
            name={status.linkedinName}
            error={status.linkedinError}
            since={status.linkedinSince}
            iconColor="bg-[#0A66C2]/10 text-[#0A66C2]"
          />
          <PlatformRow
            icon={<NextdoorIcon className="h-4.5 w-4.5" />}
            label="Nextdoor"
            loggedIn={status.nextdoor}
            name={status.nextdoorName}
            error={status.nextdoorError}
            since={status.nextdoorSince}
            iconColor="bg-[#8fca43]/10 text-[#8fca43]"
          />
          <PlatformRow
            icon={<XIcon className="h-4.5 w-4.5" />}
            label="X"
            loggedIn={status.twitter}
            name={status.twitterName}
            error={status.twitterError}
            since={status.twitterSince}
            iconColor="bg-foreground/10 text-foreground"
          />
          {(!status.facebook || !status.linkedin || !status.nextdoor || !status.twitter) &&
            (stored ? (
              // Cloud connect: no popup, no profile directory, nothing to
              // leave open. The old copy described a Chrome window on the
              // operator's PC to customers who never saw one.
              <p className="text-xs text-muted-foreground">
                Not connected means nothing is collected from that platform yet. Connect it below —
                you sign in yourself in a browser we open for you, and the login is saved so you
                won&apos;t be asked again.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Not logged in means group discovery and monitoring won&apos;t find anything for that
                platform. Use Connect below and make sure to actually finish logging in before
                closing the popup. &quot;Check failed&quot; is different — the check itself broke
                (usually a leftover window locking the profile), it says nothing about whether
                you&apos;re actually logged in.
              </p>
            ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {checking
            ? "Checking your connections…"
            : "Click \"Check Status\" to see which accounts are connected."}
        </p>
      )}

      {/* Says how the answer was arrived at.
          On the hosted site there is no browser to run a live check with, so
          this reads the saved connection instead. That is genuine evidence a
          login succeeded, but it cannot know whether the platform has since
          invalidated it — and a green badge above an empty feed is exactly the
          confusion worth heading off. */}
      {status?.source === "stored" && (
        <p className="text-xs text-muted-foreground">
          Read from your saved connections rather than by signing in again, so it is instant. If a
          platform has since logged you out, this will still show connected until the next
          collection runs — reconnect that account if leads stop arriving.
        </p>
      )}
    </div>
  )
}
