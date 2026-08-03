"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Sparkles, ExternalLink, Users } from "lucide-react"

interface Suggestion {
  query: string
  category: string
  why: string
}

const CATEGORY_TONE: Record<string, string> = {
  Neighbourhood: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "Buy & sell": "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  Homeowners: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  Community: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  Trade: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
}

export function GroupRecommendations({ defaultLocation = "" }: { defaultLocation?: string }) {
  const [trade, setTrade] = useState("")
  const [location, setLocation] = useState(defaultLocation)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, start] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuggestions(null)
    start(async () => {
      try {
        const res = await fetch("/api/groups/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trade, location }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || "Couldn't generate suggestions")
          return
        }
        setSuggestions(data.suggestions ?? [])
      } catch {
        setError("Couldn't reach the server — try again.")
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rec-trade">What do you do?</Label>
          <Input
            id="rec-trade"
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
            placeholder="e.g. Roofing"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rec-location">Where do you work?</Label>
          <Input
            id="rec-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Vancouver"
            required
          />
        </div>
        <Button type="submit" variant="brand" disabled={isPending}>
          <Sparkles className="h-3.5 w-3.5" />
          {isPending ? "Thinking…" : "Suggest groups to join"}
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {suggestions && suggestions.length === 0 && !error && (
        <EmptyState
          icon={Users}
          title="No suggestions came back"
          description="Try a broader trade or a larger nearby city."
        />
      )}

      {suggestions && suggestions.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            Search each of these on Facebook and request to join. The more you&apos;re in, the more leads
            the scan finds — you can only see posts in groups you&apos;ve joined.
          </p>
          <div className="flex flex-col gap-2">
            {suggestions.map((s, i) => (
              <div
                key={`${s.query}-${i}`}
                className="flex items-start justify-between gap-4 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{s.query}</span>
                    <Badge
                      variant="secondary"
                      className={CATEGORY_TONE[s.category] ?? CATEGORY_TONE.Community}
                    >
                      {s.category}
                    </Badge>
                  </div>
                  {s.why && <span className="text-xs text-muted-foreground">{s.why}</span>}
                </div>
                <a
                  href={`https://www.facebook.com/search/groups/?q=${encodeURIComponent(s.query)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted"
                >
                  Search
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
