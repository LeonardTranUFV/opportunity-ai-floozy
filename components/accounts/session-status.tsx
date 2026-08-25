"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, User } from "lucide-react"
import { FacebookIcon, LinkedInIcon, NextdoorIcon, XIcon } from "@/components/icons"

interface Status {
  facebook: boolean
  facebookName: string | null
  facebookError: string | null
  linkedin: boolean
  linkedinName: string | null
  linkedinError: string | null
  nextdoor: boolean
  nextdoorName: string | null
  nextdoorError: string | null
  twitter: boolean
  twitterName: string | null
  twitterError: string | null
}

function PlatformRow({
  icon,
  label,
  loggedIn,
  name,
  error,
  iconColor,
}: {
  icon: React.ReactNode
  label: string
  loggedIn: boolean
  name: string | null
  error: string | null
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
                {loggedIn ? "Logged in" : error ? "Couldn't check" : "Not connected"}
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

export function SessionStatus() {
  const [status, setStatus] = useState<Status | null>(null)
  const [checking, setChecking] = useState(false)

  const handleCheck = async () => {
    setChecking(true)
    try {
      const res = await fetch("/api/accounts/status")
      const data = await res.json()
      if (res.ok && data.success) {
        setStatus({
          facebook: data.facebook,
          facebookName: data.facebookName,
          facebookError: data.facebookError,
          linkedin: data.linkedin,
          linkedinName: data.linkedinName,
          linkedinError: data.linkedinError,
          nextdoor: data.nextdoor,
          nextdoorName: data.nextdoorName,
          nextdoorError: data.nextdoorError,
          twitter: data.twitter,
          twitterName: data.twitterName,
          twitterError: data.twitterError,
        })
      }
    } finally {
      setChecking(false)
    }
  }

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
            iconColor="bg-[#1877F2]/10 text-[#1877F2]"
          />
          <PlatformRow
            icon={<LinkedInIcon className="h-4.5 w-4.5" />}
            label="LinkedIn"
            loggedIn={status.linkedin}
            name={status.linkedinName}
            error={status.linkedinError}
            iconColor="bg-[#0A66C2]/10 text-[#0A66C2]"
          />
          <PlatformRow
            icon={<NextdoorIcon className="h-4.5 w-4.5" />}
            label="Nextdoor"
            loggedIn={status.nextdoor}
            name={status.nextdoorName}
            error={status.nextdoorError}
            iconColor="bg-[#8fca43]/10 text-[#8fca43]"
          />
          <PlatformRow
            icon={<XIcon className="h-4.5 w-4.5" />}
            label="X"
            loggedIn={status.twitter}
            name={status.twitterName}
            error={status.twitterError}
            iconColor="bg-foreground/10 text-foreground"
          />
          {(!status.facebook || !status.linkedin || !status.nextdoor || !status.twitter) && (
            <p className="text-xs text-muted-foreground">
              Not logged in means group discovery and monitoring won&apos;t find anything for that
              platform. Use Connect below and make sure to actually finish logging in before closing
              the popup. &quot;Check failed&quot; is different — the check itself broke (usually a
              leftover window locking the profile), it says nothing about whether you&apos;re
              actually logged in.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Click &quot;Check Status&quot; to verify whether your saved sessions are actually logged in,
          and see which account is connected (takes ~15-25s, opens a background browser).
        </p>
      )}
    </div>
  )
}
