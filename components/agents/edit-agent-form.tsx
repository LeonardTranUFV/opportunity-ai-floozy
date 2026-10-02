"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { LocationPicker } from "@/components/agents/location-picker"
import { readApiError, CONNECTION_ERROR } from "@/lib/format-error"

export interface EditableAgent {
  id: string
  name: string
  goal: string
  location: string | null
  keywords: string | null
  negative_keywords: string | null
}

/**
 * One page, every field, saved together.
 *
 * Creating an agent is a three-step wizard because a new customer needs
 * leading through it. Editing is the opposite situation: somebody who already
 * has an agent is here to change one thing — usually a keyword list that is
 * too narrow — and stepping them through three screens to reach it would be
 * worse, not kinder.
 */
export function EditAgentForm({ agent }: { agent: EditableAgent }) {
  const router = useRouter()

  const [name, setName] = useState(agent.name)
  const [goal, setGoal] = useState(agent.goal)
  const [locations, setLocations] = useState<string[]>(
    (agent.location ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  )
  const [keywords, setKeywords] = useState(agent.keywords ?? "")
  const [negativeKeywords, setNegativeKeywords] = useState(agent.negative_keywords ?? "")

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          goal,
          location: locations.join(", "),
          keywords,
          negative_keywords: negativeKeywords,
        }),
      })
      if (!res.ok) {
        setError(await readApiError(res, "Couldn't save the agent."))
        return
      }
      router.push("/agents")
      // The agents list is a server component, so without this it renders the
      // values it was built with and the save looks as though it did nothing.
      router.refresh()
    } catch {
      setError(CONNECTION_ERROR)
    } finally {
      setSaving(false)
    }
  }

  const canSave = !saving && name.trim().length > 0 && goal.trim().length > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit agent</CardTitle>
        <CardDescription>
          Changes apply to the next scan. Opportunities this agent has already found are kept.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Agent name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Roofing Scout" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal">What should it look for?</Label>
          <Textarea
            id="goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={5}
            placeholder="e.g. I'm a roofer in Vancouver. I want homeowners with roof leaks or storm damage who need repairs."
          />
          <p className="text-xs text-muted-foreground">
            This is what the AI scores every post against, so plain English about the work you want beats a list of
            terms.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Where do you operate?</Label>
          <LocationPicker value={locations} onChange={setLocations} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="keywords">Keywords</Label>
          <Input
            id="keywords"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="e.g. roof, leak, shingle, contractor"
          />
          <p className="text-xs text-muted-foreground">
            Short, broad stems beat phrases. A post these never match is a post the scoring never sees — and nobody
            types &ldquo;hardwood refinishing&rdquo; when their floor is ruined.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="negative_keywords">Negative keywords (optional)</Label>
          <Input
            id="negative_keywords"
            value={negativeKeywords}
            onChange={(e) => setNegativeKeywords(e.target.value)}
            placeholder="e.g. hiring, job, DIY"
          />
          <p className="text-xs text-muted-foreground">
            Leave empty unless an agent is returning the wrong kind of post. These are the commonest cause of an agent
            that finds nothing.
          </p>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>

      <CardFooter className="flex justify-end gap-2">
        <Button variant="outline" nativeButton={false} render={<Link href="/agents" />}>
          Cancel
        </Button>
        <Button variant="brand" onClick={save} disabled={!canSave}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </CardFooter>
    </Card>
  )
}
