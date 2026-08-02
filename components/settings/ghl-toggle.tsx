"use client"

import { useState, useTransition } from "react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

export function GhlToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [isPending, startTransition] = useTransition()

  const handleChange = (checked: boolean) => {
    setEnabled(checked)
    startTransition(async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ghl_dispatch_enabled: checked ? "true" : "false" }),
      })
      if (!res.ok) setEnabled(!checked)
    })
  }

  return (
    <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor="ghl_dispatch_enabled" className="font-medium">
          Dispatch approved leads to GoHighLevel
        </Label>
        <span className="text-xs text-muted-foreground">
          When off, clicking Approve just marks the lead handled — nothing gets pushed to GHL.
        </span>
      </div>
      <Switch
        id="ghl_dispatch_enabled"
        checked={enabled}
        onCheckedChange={handleChange}
        disabled={isPending}
      />
    </div>
  )
}
