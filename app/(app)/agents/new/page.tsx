"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

export default function NewAgentPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const [formData, setFormData] = useState({
    name: "",
    goal: "",
    location: "",
    keywords: "",
    negative_keywords: ""
  })

  const nextStep = () => setStep((s) => Math.min(s + 1, 4))
  const prevStep = () => setStep((s) => Math.max(s - 1, 1))

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target
    setFormData(prev => ({ ...prev, [id]: value }))
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
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

  return (
    <div className="flex h-[80vh] w-full items-center justify-center">
      <Card className="w-[500px]">
        <CardHeader>
          <CardTitle>Create AI Agent</CardTitle>
          <CardDescription>Step {step} of 4: Setup your Opportunity Intelligence Agent.</CardDescription>
          <div className="mt-3 flex gap-1.5">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  s <= step ? "bg-brand" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="goal">What are you looking for?</Label>
                <Input id="goal" value={formData.goal} onChange={handleInputChange} placeholder="e.g. I'm looking for homeowners needing roof repairs." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Agent Name</Label>
                <Input id="name" value={formData.name} onChange={handleInputChange} placeholder="e.g. Roofing Scout" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="location">Where do you operate?</Label>
                <Input id="location" value={formData.location} onChange={handleInputChange} placeholder="e.g. Vancouver, Burnaby, Richmond" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="keywords">Keywords</Label>
                <Input id="keywords" value={formData.keywords} onChange={handleInputChange} placeholder="e.g. roof leak, need roofer" />
                <p className="text-xs text-muted-foreground">Comma separated values</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="negative_keywords">Negative Keywords</Label>
                <Input id="negative_keywords" value={formData.negative_keywords} onChange={handleInputChange} placeholder="e.g. DIY, hiring, looking for job" />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label>Select Sources</Label>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="fb"
                    className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm transition-colors has-[:checked]:border-brand/40 has-[:checked]:bg-brand/5"
                  >
                    <input type="checkbox" id="fb" className="h-4 w-4 rounded border-input accent-brand" defaultChecked />
                    Facebook Groups
                  </label>
                  <label
                    htmlFor="li"
                    className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm transition-colors has-[:checked]:border-brand/40 has-[:checked]:bg-brand/5"
                  >
                    <input type="checkbox" id="li" className="h-4 w-4 rounded border-input accent-brand" defaultChecked />
                    LinkedIn Communities
                  </label>
                  <label
                    htmlFor="re"
                    className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors has-[:checked]:border-brand/40 has-[:checked]:bg-brand/5"
                  >
                    <input type="checkbox" id="re" className="h-4 w-4 rounded border-input accent-brand" defaultChecked />
                    Reddit Forums
                    <span className="ml-auto text-xs italic">coming soon</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={prevStep} disabled={step === 1 || isSubmitting}>
            Back
          </Button>
          <Button variant="brand" onClick={step === 4 ? handleSubmit : nextStep} disabled={isSubmitting}>
            {step === 4 ? (isSubmitting ? "Deploying..." : "Deploy Agent") : "Continue"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}