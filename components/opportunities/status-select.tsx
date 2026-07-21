"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"

const STATUSES = ["new", "contacted", "qualified", "appointment", "proposal", "won", "lost"] as const

export function StatusSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleChange = (value: string) => {
    startTransition(async () => {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: value }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        alert("Failed to update status")
      }
    })
  }

  return (
    <select
      value={status}
      disabled={isPending}
      onChange={(e) => handleChange(e.target.value)}
      className="h-7 rounded-md border bg-background px-2 text-xs capitalize outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s} className="capitalize">
          {s}
        </option>
      ))}
    </select>
  )
}
