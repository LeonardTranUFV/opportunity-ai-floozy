"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, User } from "lucide-react"
import { FacebookIcon, LinkedInIcon } from "@/components/icons"

interface Status {
  facebook: boolean
  facebookName: string | null
  linkedin: boolean
  linkedinName: string | null
}

function PlatformRow({
  icon,
  label,
  loggedIn,
  name,
  iconColor,
}: {
  icon: React.ReactNode
  label: string
  loggedIn: boolean
  name: string | null
  iconColor: string
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-3">
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
              {loggedIn ? "Logged in" : "Not connected"}
            </span>
          )}
        </div>
      </div>
      <Badge variant={loggedIn ? "success" : "secondary"}>{loggedIn ? "Connected" : "Not logged in"}</Badge>
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
          linkedin: data.linkedin,
          linkedinName: data.linkedinName,
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
            iconColor="bg-[#1877F2]/10 text-[#1877F2]"
          />
          <PlatformRow
            icon={<LinkedInIcon className="h-4.5 w-4.5" />}
            label="LinkedIn"
            loggedIn={status.linkedin}
            name={status.linkedinName}
            iconColor="bg-[#0A66C2]/10 text-[#0A66C2]"
          />
          {(!status.facebook || !status.linkedin) && (
            <p className="text-xs text-muted-foreground">
              Not logged in means group discovery and scraping won&apos;t find anything for that
              platform. Use Connect below and make sure to actually finish logging in before closing
              the popup.
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
