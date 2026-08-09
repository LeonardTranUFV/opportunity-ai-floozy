"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { PRIVACY_MODE_KEY } from "@/lib/privacy-mode"

export function PrivacyModeToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [isPending, startTransition] = useTransition()

  const handleChange = (checked: boolean) => {
    setEnabled(checked)
    startTransition(async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [PRIVACY_MODE_KEY]: checked ? "on" : "off" }),
      })
      if (!res.ok) {
        setEnabled(!checked)
        return
      }
      // Every page that shows a name is server-rendered, so they need to be
      // re-fetched — otherwise you flip the switch, walk to Opportunities, and
      // the names are still there.
      router.refresh()
    })
  }

  return (
    <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={PRIVACY_MODE_KEY} className="font-medium">
          Hide lead identities
        </Label>
        <span className="text-xs text-muted-foreground">
          Turn on before recording or screen-sharing. Names show as initials and phone numbers are
          partly hidden, everywhere in the app. Nothing is deleted — switch it off and the full
          details come straight back.
        </span>
      </div>
      <Switch
        id={PRIVACY_MODE_KEY}
        checked={enabled}
        onCheckedChange={handleChange}
        disabled={isPending}
      />
    </div>
  )
}
