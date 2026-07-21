"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

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
    <Select value={status} onValueChange={(v) => v && handleChange(v)} disabled={isPending}>
      <SelectTrigger size="sm" className="w-full capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map((s) => (
          <SelectItem key={s} value={s} className="capitalize">
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
