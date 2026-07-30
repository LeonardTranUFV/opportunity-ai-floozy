"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RefreshCcw } from "lucide-react"

// value "0" means off — Radix Select can't use an empty string as a real
// option value, so off is modeled as its own item rather than null directly.
const INTERVAL_OPTIONS = [
  { value: "0", hours: null as number | null, label: "Auto-scan: Off" },
  { value: "1", hours: 1, label: "Auto-scan: Every hour" },
  { value: "4", hours: 4, label: "Auto-scan: Every 4 hours" },
  { value: "12", hours: 12, label: "Auto-scan: Every 12 hours" },
]

export function AutoScanSelect({ id, intervalHours }: { id: string; intervalHours: number | null }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [value, setValue] = useState(String(intervalHours ?? 0))
  const [error, setError] = useState(false)

  const handleChange = (v: string | null) => {
    if (!v) return
    const prev = value
    setValue(v)
    setError(false)
    const hours = INTERVAL_OPTIONS.find((opt) => opt.value === v)?.hours ?? null
    startTransition(async () => {
      const res = await fetch(`/api/agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_scan_interval_hours: hours }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        setValue(prev)
        setError(true)
      }
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <Select value={value} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger className="w-full" aria-label="Auto-scan schedule">
          <RefreshCcw className="h-3.5 w-3.5 text-muted-foreground" />
          <SelectValue>{(v: string) => INTERVAL_OPTIONS.find((opt) => opt.value === v)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {INTERVAL_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">Couldn&apos;t save — try again.</p>}
    </div>
  )
}
