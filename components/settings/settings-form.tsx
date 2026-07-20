"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"

const GOAL_OPTIONS = [
  { value: "home_services", label: "Home Services (contractors, roofers, plumbers, electricians)" },
  { value: "nail_salon_beauty", label: "Nail Salon / Beauty" },
  { value: "job_hunting", label: "Job Hunting / Hiring" },
  { value: "car_sales", label: "Car Sales" },
  { value: "product_sales", label: "Product / Wholesale Sales" },
  { value: "other_custom", label: "Other (use custom instructions below)" },
]

export function SettingsForm({
  initialGoal,
  initialLanguages,
  initialCustomRules,
}: {
  initialGoal: string
  initialLanguages: string
  initialCustomRules: string
}) {
  const [goal, setGoal] = useState(initialGoal)
  const [languages, setLanguages] = useState(initialLanguages)
  const [customRules, setCustomRules] = useState(initialCustomRules)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(false)
    startTransition(async () => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai_goal: goal,
          ai_languages: languages,
          ai_custom_rules: customRules,
        }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        alert("Failed to save settings")
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="ai_goal">What is the AI generally looking for?</Label>
        <select
          id="ai_goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          {GOAL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          This is the default goal used by the legacy scraping pipeline. Individual AI Agents
          each have their own goal set when created.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ai_languages">Languages to parse</Label>
        <Input
          id="ai_languages"
          value={languages}
          onChange={(e) => setLanguages(e.target.value)}
          placeholder="English, Vietnamese (Tiếng Việt)"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ai_custom_rules">Custom rules</Label>
        <textarea
          id="ai_custom_rules"
          value={customRules}
          onChange={(e) => setCustomRules(e.target.value)}
          rows={5}
          className="w-full rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          placeholder="Look for people needing help. Be polite and helpful."
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save Settings"}
        </Button>
        {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
      </div>
    </div>
  )
}
