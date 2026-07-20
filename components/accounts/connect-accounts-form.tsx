"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

type Platform = "facebook" | "linkedin"

export function ConnectAccountsForm() {
  const router = useRouter()
  const [launching, setLaunching] = useState<Platform | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleLaunch = async (platform: Platform) => {
    setLaunching(platform)
    setMessage(null)
    try {
      const endpoint = platform === "facebook" ? "/api/auth-session" : "/api/auth-linkedin"
      const res = await fetch(endpoint, { method: "POST" })
      const data = await res.json()
      if (res.ok) {
        const syncMsg =
          data.sync && data.sync.found > 0
            ? ` (Automatically imported and synced ${data.sync.found} of your Facebook groups!)`
            : ""
        setMessage(
          `✓ ${platform === "facebook" ? "Facebook" : "LinkedIn"} session successfully linked and saved!${syncMsg} The crawler is now active and authenticated.`
        )
        router.refresh()
      } else {
        setMessage(`❌ Session launch failed: ${data.error || "Unknown error"}`)
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
        <div className="flex w-full justify-center gap-4">
          <Button className="max-w-70 flex-1" onClick={() => handleLaunch("facebook")}>
            Connect Facebook
          </Button>
          <Button
            className="max-w-70 flex-1 bg-[#0a66c2] text-white hover:bg-[#0a66c2]/90"
            onClick={() => handleLaunch("linkedin")}
          >
            Connect LinkedIn
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
