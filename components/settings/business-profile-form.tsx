"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"

export function BusinessProfileForm({
  initialOwnerName,
  initialBusinessName,
  initialPhone,
  initialPitch,
}: {
  initialOwnerName: string
  initialBusinessName: string
  initialPhone: string
  initialPitch: string
}) {
  const [ownerName, setOwnerName] = useState(initialOwnerName)
  const [businessName, setBusinessName] = useState(initialBusinessName)
  const [phone, setPhone] = useState(initialPhone)
  const [pitch, setPitch] = useState(initialPitch)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(false)
    startTransition(async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_owner_name: ownerName,
          business_name: businessName,
          business_phone: phone,
          business_pitch: pitch,
        }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        alert("Failed to save business profile")
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="owner_name">Your Name</Label>
          <Input
            id="owner_name"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="e.g. Leo"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="business_name">Company / Business Name</Label>
          <Input
            id="business_name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. Leo's Contracting"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="business_phone">Best Phone Number to Reach You</Label>
        <Input
          id="business_phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. (604) 555-0142"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="business_pitch">Your Pitch / What Makes You Stand Out</Label>
        <Input
          id="business_pitch"
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          placeholder="e.g. 10+ years experience, free quotes, same-day service"
        />
        <p className="text-xs text-muted-foreground">
          Optional, but recommended — the AI weaves this into generated replies so they sound like you,
          not a template. e.g. &quot;Hey Mike, I&apos;m Leo — been doing contracting for years, let me get
          my team out there today for a free quote.&quot;
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save Business Profile"}
        </Button>
        {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
      </div>
    </div>
  )
}
