"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FacebookIcon, LinkedInIcon, NextdoorIcon, XIcon } from "@/components/icons"

type Platform = "facebook" | "linkedin" | "nextdoor" | "twitter"

const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: "Facebook",
  linkedin: "LinkedIn",
  nextdoor: "Nextdoor",
  twitter: "X",
}

export function ConnectAccountsForm() {
  const router = useRouter()
  const [launching, setLaunching] = useState<Platform | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleLaunch = async (platform: Platform) => {
    setLaunching(platform)
    setMessage(null)
    try {
      const endpoint = {
        facebook: "/api/auth-session",
        linkedin: "/api/auth-linkedin",
        nextdoor: "/api/auth-nextdoor",
        twitter: "/api/auth-twitter",
      }[platform]
      const res = await fetch(endpoint, { method: "POST" })
      const data = await res.json()
      if (res.ok) {
        const syncMsg =
          data.sync && data.sync.found > 0
            ? ` (Automatically imported and synced ${data.sync.found} of your Facebook groups!)`
            : ""
        setMessage(
          `✓ ${PLATFORM_LABEL[platform]} session successfully linked and saved!${syncMsg} The crawler is now active and authenticated.`
        )
        router.refresh()
      } else {
        setMessage(`❌ ${PLATFORM_LABEL[platform]} session launch failed: ${data.error || "Unknown error"}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      setMessage(`❌ API connection error: ${message}`)
    } finally {
      setLaunching(null)
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {launching ? (
        <div className="flex flex-col items-center gap-2 py-2">
          <span className="h-4 w-4 animate-pulse rounded-full bg-blue-600" />
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Headed browser active…
          </span>
          <p className="text-center text-xs text-muted-foreground">
            Log in securely on the popup window, then close it manually to finish.
          </p>
        </div>
      ) : (
        <div className="flex w-full flex-wrap justify-center gap-4">
          <Button
            className="max-w-70 flex-1 bg-[#1877F2] text-white hover:bg-[#1877F2]/90"
            onClick={() => handleLaunch("facebook")}
          >
            <FacebookIcon className="h-4 w-4" />
            Connect Facebook
          </Button>
          <Button
            className="max-w-70 flex-1 bg-[#0A66C2] text-white hover:bg-[#0A66C2]/90"
            onClick={() => handleLaunch("linkedin")}
          >
            <LinkedInIcon className="h-4 w-4" />
            Connect LinkedIn
          </Button>
          <Button
            className="max-w-70 flex-1 bg-[#8fca43] text-white hover:bg-[#8fca43]/90"
            onClick={() => handleLaunch("nextdoor")}
          >
            <NextdoorIcon className="h-4 w-4" />
            Connect Nextdoor
          </Button>
          <Button
            className="max-w-70 flex-1 bg-black text-white hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/85"
            onClick={() => handleLaunch("twitter")}
          >
            <XIcon className="h-4 w-4" />
            Connect X
          </Button>
        </div>
      )}

      {message && (
        <p
          className={`w-full rounded-lg border p-3 text-center text-sm font-medium ${
            message.startsWith("✓")
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-destructive/20 bg-destructive/10 text-destructive"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  )
}
