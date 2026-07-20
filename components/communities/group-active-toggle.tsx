"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"

export function GroupActiveToggle({ id, active }: { id: number; active: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleToggle = () => {
    startTransition(async () => {
      const res = await fetch("/api/groups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active: !active }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        alert("Failed to update group")
      }
    })
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`h-6 rounded-full px-2 text-xs font-medium transition-colors disabled:opacity-50 ${
        active ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
      }`}
    >
      {active ? "Active" : "Paused"}
    </button>
  )
}
