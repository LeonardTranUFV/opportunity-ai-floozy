"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CheckCircle2, XCircle, RefreshCw } from "lucide-react"

interface Status {
  facebook: boolean
  linkedin: boolean
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
        setStatus({ facebook: data.facebook, linkedin: data.linkedin })
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
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center gap-2">
            {status.facebook ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive" />
            )}
            <span>Facebook — {status.facebook ? "logged in" : "not logged in"}</span>
          </div>
          <div className="flex items-center gap-2">
            {status.linkedin ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive" />
            )}
            <span>LinkedIn — {status.linkedin ? "logged in" : "not logged in"}</span>
          </div>
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
          Click &quot;Check Status&quot; to verify whether your saved sessions are actually logged in
          (takes ~10-20s, opens a background browser).
        </p>
      )}
    </div>
  )
}
