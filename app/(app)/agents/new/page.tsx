"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { LocationPicker } from "@/components/agents/location-picker"
import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

const TOTAL_STEPS = 3
const STEP_TITLES = ["Tell us about your business", "Where do you operate?", "Keywords"]

export default function NewAgentPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)
  const [enhanced, setEnhanced] = useState(false)

  const [name, setName] = useState("")
  const [goal, setGoal] = useState("")
  const [locations, setLocations] = useState<string[]>([])
  const [keywords, setKeywords] = useState("")
  const [negativeKeywords, setNegativeKeywords] = useState("")

  const canContinueStep1 = name.trim().length > 0 && goal.trim().length >= 10
  const canContinueStep2 = locations.length > 0
  const canDeploy = keywords.trim().length > 0

  const nextStep = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS))
  const prevStep = () => setStep((s) => Math.max(s - 1, 1))

  // Shared by both AI actions: step 1's "Enhance with AI" (rewrites the goal,
  // guesses a name/location, and fills keywords) and step 3's "AI Suggest"
  // (keywords only, so it doesn't clobber a location/name already set).
  const runEnhance = async (applyAll: boolean) => {
    if (goal.trim().length < 10) {
      setEnhanceError("Write a sentence or two first — a few words isn't enough for AI to work with.")
      return
    }
    setEnhanceError(null)
    setIsEnhancing(true)
    try {
      const res = await fetch("/api/agents/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: goal }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setEnhanceError(data.error || "AI enhancement failed")
        return
      }
      if (applyAll) {
        setGoal(data.goal)
        if (!name.trim() && data.suggested_name) setName(data.suggested_name)
        if (data.location) {
          const guessed = (data.location as string)
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
          if (guessed.length > 0) setLocations((prev) => [...new Set([...prev, ...guessed])])
        }
      }
      setKeywords(data.keywords || "")
      setNegativeKeywords(data.negative_keywords || "")
      setEnhanced(true)
    } catch {
      setEnhanceError("AI enhancement failed — check the server log.")
    } finally {
      setIsEnhancing(false)
    }
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          goal,
          location: locations.join(", "),
          keywords,
          negative_keywords: negativeKeywords,
        }),
      })
      if (res.ok) {
        router.push("/agents")
      } else {
        alert("Failed to save agent")
      }
    } catch (error) {
      console.error(error)
      alert("Error saving agent")
    } finally {
      setIsSubmitting(false)
    }
  }

  const continueDisabled =
    isSubmitting ||
    (step === 1 && !canContinueStep1) ||
    (step === 2 && !canContinueStep2) ||
    (step === TOTAL_STEPS && !canDeploy)

  return (
    <div className="flex h-[80vh] w-full items-center justify-center">
      <Card className="w-[520px]">
        <CardHeader>
          <CardTitle>Create AI Agent</CardTitle>
          <CardDescription>
            Step {step} of {TOTAL_STEPS}: {STEP_TITLES[step - 1]}
          </CardDescription>
          <div className="mt-3 flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? "bg-brand" : "bg-muted"}`}
              />
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="goal">Tell us about your business, in your own words</Label>
                <Textarea
                  id="goal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={4}
                  placeholder="e.g. I'm a roofer in Vancouver. I want to find homeowners with roof leaks or storm damage who need repairs."
                />
                <p className="text-xs text-muted-foreground">
                  A sentence or two is enough — AI turns this into precise search criteria and keywords.
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => runEnhance(true)}
                disabled={isEnhancing}
                className="w-fit"
              >
                <Sparkles className={cn("h-3.5 w-3.5", isEnhancing && "animate-pulse")} />
                {isEnhancing ? "Enhancing…" : enhanced ? "Re-enhance with AI" : "Enhance with AI"}
              </Button>
              {enhanceError && <p className="text-xs text-destructive">{enhanceError}</p>}
              {enhanced && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  AI expanded this into a fuller goal, suggested keywords, and guessed a location — review
                  the next steps.
                </p>
              )}

              <div className="space-y-2">
                <Label htmlFor="name">Agent Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Roofing Scout"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-2">
              <Label>Where do you operate?</Label>
              <LocationPicker value={locations} onChange={setLocations} />
              <p className="text-xs text-muted-foreground">
                Pick your city and nearby areas get suggested automatically — no need to type them all out.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="keywords">Keywords</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => runEnhance(false)}
                    disabled={isEnhancing}
                  >
                    <Sparkles className="h-3 w-3" />
                    {isEnhancing ? "Thinking…" : "AI Suggest"}
                  </Button>
                </div>
                <Input
                  id="keywords"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g. roof leak, need roofer"
                />
                <p className="text-xs text-muted-foreground">
                  Comma separated — most people can't brainstorm a full list themselves, so let AI suggest one.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="negative_keywords">Negative Keywords (optional)</Label>
                <Input
                  id="negative_keywords"
                  value={negativeKeywords}
                  onChange={(e) => setNegativeKeywords(e.target.value)}
                  placeholder="e.g. DIY, hiring, looking for job"
                />
              </div>
              {enhanceError && <p className="text-xs text-destructive">{enhanceError}</p>}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={prevStep} disabled={step === 1 || isSubmitting}>
            Back
          </Button>
          <Button variant="brand" onClick={step === TOTAL_STEPS ? handleSubmit : nextStep} disabled={continueDisabled}>
            {step === TOTAL_STEPS ? (isSubmitting ? "Deploying..." : "Deploy Agent") : "Continue"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
