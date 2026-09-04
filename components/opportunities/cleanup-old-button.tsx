"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { readApiError, formatApiError, CONNECTION_ERROR } from "@/lib/format-error"

const DAY_OPTIONS = [
  { value: "7", label: "7+ days old" },
  { value: "14", label: "14+ days old" },
  { value: "30", label: "30+ days old" },
  { value: "60", label: "60+ days old" },
]

export function CleanupOldButton() {
  const router = useRouter()
  const [days, setDays] = useState("14")
  const [isPending, startTransition] = useTransition()

  const handleCleanup = () => {
    const label = DAY_OPTIONS.find((o) => o.value === days)?.label ?? `${days}+ days old`
    if (
      !confirm(
        `Delete every "New" or "Lost" lead ${label}? Leads you're actively working (Qualified, Appointment, Proposal, Won) are never touched. This can't be undone.`
      )
    )
      return

    startTransition(async () => {
      try {
        const res = await fetch("/api/opportunities/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days: Number(days) }),
        })
        if (!res.ok) {
          alert(await readApiError(res, "Couldn't clean up old leads"))
          return
        }
        const data = await res.json()
        if (!data.success) {
          alert(formatApiError(data.error) || "Couldn't clean up old leads — try again.")
          return
        }
        alert(data.deleted === 0 ? "No leads matched — nothing removed." : `Removed ${data.deleted} old lead(s).`)
        router.refresh()
      } catch {
        alert(CONNECTION_ERROR)
      }
    })
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select value={days} onValueChange={(v) => v && setDays(v)}>
        <SelectTrigger className="min-w-[8rem]">
          <SelectValue>{(v: string) => DAY_OPTIONS.find((o) => o.value === v)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {DAY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" onClick={handleCleanup} disabled={isPending}>
        <Trash2 className="h-3.5 w-3.5" />
        {isPending ? "Cleaning up…" : "Clean Up Old Leads"}
      </Button>
    </div>
  )
}
