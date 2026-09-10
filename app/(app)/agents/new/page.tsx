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
import { readApiError, CONNECTION_ERROR } from "@/lib/format-error"
import { AGENT_TEMPLATES, type AgentTemplate } from "@/lib/agent-templates"

const TOTAL_STEPS = 3
const STEP_TITLES = ["Tell us about your business", "Where do you operate?", "Keywords"]

export default function NewAgentPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)
  const [enhanced, setEnhanced] = useState(false)
  const [templateId, setTemplateId] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [goal, setGoal] = useState("")
  const [locations, setLocations] = useState<string[]>([])
  const [keywords, setKeywords] = useState("")
  const [negativeKeywords, setNegativeKeywords] = useState("")
  const [audience, setAudience] = useState<"customers" | "providers">("customers")

  const canContinueStep1 = name.trim().length > 0 && goal.trim().length >= 10
  const canContinueStep2 = locations.length > 0
  const canDeploy = keywords.trim().length > 0

  const nextStep = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS))
  const prevStep = () => setStep((s) => Math.max(s - 1, 1))

  /**
   * Prefill from a trade rather than leaving step 1 blank.
   *
   * A blank textarea is where zero-result agents come from: the operator
   * writes a few vague words, the enhancer expands them into something
   * plausible, and the keywords come out as multi-word phrases that never
   * match how people actually post. lib/agent-templates.ts carries the
   * measured comparison behind the wording of these.
   */
  const applyTemplate = (t: AgentTemplate) => {
    setTemplateId(t.id)
    setName(t.name)
    setGoal(t.goal)
    setKeywords(t.keywords)
    setEnhanceError(null)
    setEnhanced(false)
  }

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
      setEnhanceError(CONNECTION_ERROR)
    } finally {
      setIsEnhancing(false)
    }
  }

  /**
   * The direction of intent, written into the goal rather than stored beside it.
   *
   * The goal is what the scoring prompt actually reads, and the prompt treats
   * an explicit statement there as overriding its default. Putting the answer
   * in the same sentence needs no column, no migration and no second source of
   * truth — and it stays editable afterwards, which a hidden flag would not be.
   *
   * It earns its place because the failure it prevents is the common one: an
   * agent for a trade matches every post in that trade, including the ads from
   * everybody else who does it.
   */
  const goalWithAudience = () => {
    const base = goal.trim()
    const note =
      audience === "customers"
        ? "Only include posts from people who want this work done for them. Posts from businesses advertising or offering this service are not opportunities."
        : "Only include posts from people offering or advertising this service, or looking for work in it."
    if (base.includes(note)) return base
    // Close the sentence first. The goal is shown on the agent card as plain
    // text, where the blank line collapses — without this it reads as
    // "...looking for contracting job Only include posts from people who...".
    const closed = /[.!?]$/.test(base) ? base : `${base}.`
    return `${closed}\n\n${note}`
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          goal: goalWithAudience(),
          location: locations.join(", "),
          keywords,
          negative_keywords: negativeKeywords,
        }),
      })
      if (res.ok) {
        router.push("/agents")
      } else {
        alert(await readApiError(res, "Couldn't save the agent"))
      }
    } catch (error) {
      console.error(error)
      alert(CONNECTION_ERROR)
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
    // min-h + py rather than a locked 80vh: the later steps are taller than the
    // first, and on a phone a fixed-height centred box pushed content off-screen
    // with no way to scroll to it.
    <div className="flex min-h-[80vh] w-full items-start justify-center py-4 sm:items-center">
      <Card className="w-full max-w-[520px]">
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
                <Label>Start from your trade</Label>
                <div className="flex flex-wrap gap-1.5">
                  {AGENT_TEMPLATES.map((t) => (
                    <Button
                      key={t.id}
                      type="button"
                      variant={templateId === t.id ? "brand" : "outline"}
                      size="xs"
                      onClick={() => applyTemplate(t)}
                    >
                      <span aria-hidden>{t.icon}</span>
                      {t.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Fills in a goal and a keyword set that is known to find leads. Change anything below.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Who should this agent find?</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      {
                        id: "customers",
                        title: "People who need my service",
                        hint: "Someone asking for a plumber, a quote, a recommendation.",
                      },
                      {
                        id: "providers",
                        title: "People who offer this service",
                        hint: "Businesses advertising, or people looking for work in it.",
                      },
                    ] as const
                  ).map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      onClick={() => setAudience(choice.id)}
                      aria-pressed={audience === choice.id}
                      className={`flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors ${
                        audience === choice.id
                          ? "border-brand bg-brand/[0.06]"
                          : "border-border hover:border-brand/40 hover:bg-brand/[0.03]"
                      }`}
                    >
                      <span className="text-sm font-medium">{choice.title}</span>
                      <span className="text-xs text-muted-foreground">{choice.hint}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Almost everyone wants the first one. Without this, an agent for your trade matches
                  every post in that trade — including the ads from everyone else who does it.
                </p>
              </div>

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
                  Comma separated — most people can&apos;t brainstorm a full list themselves, so let AI suggest one.
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
