"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

/**
 * "Re-read the groups I'm in."
 *
 * The import runs once, during connect, against whatever Facebook had
 * rendered at that moment — its group sidebar loads lazily, so a first pass
 * routinely catches only some of them. It also cannot know about anything
 * joined since. Before this the only remedy was disconnecting and logging in
 * again, which is the most expensive thing we ask anyone to do.
 *
 * Deliberately not automatic. It drives a real browser through that person's
 * own Facebook session, and running it on a schedule turns an occasional
 * action into a repeating pattern of exactly the kind that gets accounts
 * flagged. A button means it happens when someone has a reason.
 */
export function ResyncGroupsButton() {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setRunning(true)
    setMessage(null)
    setError(null)
    try {
      const res = await fetch("/api/groups/resync", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Could not refresh your groups.")
        return
      }
      setMessage(data.message ?? "Done.")
      // New rows arrive inactive, so the list behind this needs re-reading.
      router.refresh()
    } catch {
      setError("Could not reach the server. Try again in a moment.")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="outline" onClick={run} disabled={running} className="w-full sm:w-auto">
        <RefreshCw className={running ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        {running ? "Reading your groups…" : "Refresh my Facebook groups"}
      </Button>

      {running ? (
        <p className="text-xs text-muted-foreground">
          Opening a browser with your saved login. This takes about half a minute.
        </p>
      ) : null}

      {message ? (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {error}
        </p>
      ) : null}
    </div>
  )
}
