"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { addSource } from "@/lib/add-source"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Sparkles, ExternalLink, Users, Radar, Check, CircleAlert, Loader2, Plus } from "lucide-react"

interface Suggestion {
  query: string
  category: string
  why: string
}

/**
 * A suggestion is a phrase Gemini invented, not a group that is known to
 * exist — it has no URL, and monitoring needs one. "Track" therefore runs the
 * real Facebook search for that phrase through the user's own connected
 * session, and what comes back are actual groups with actual URLs.
 *
 * The `joined` flag is the part that matters. Facebook only serves a group's
 * posts to its members, so tracking a group the account hasn't joined stores a
 * source that will scrape zero posts forever — indistinguishable, from the
 * dashboard, from a group where nobody happens to need a plumber this week.
 * Unjoined groups are still addable, because joining is a human step that
 * happens later, but they are labelled so the silence is explained.
 */
interface FoundGroup {
  name: string
  url: string
  platform: string
  description: string
  joined?: boolean
}

interface TrackState {
  status: "searching" | "done" | "error"
  groups: FoundGroup[]
  error?: string
}

const CATEGORY_TONE: Record<string, string> = {
  Neighbourhood: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "Buy & sell": "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  Homeowners: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  Community: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  Trade: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
}

export function GroupRecommendations({ defaultLocation = "" }: { defaultLocation?: string }) {
  const router = useRouter()
  const [trade, setTrade] = useState("")
  const [location, setLocation] = useState(defaultLocation)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, start] = useTransition()
  const [tracked, setTracked] = useState<Record<string, TrackState>>({})
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set())
  const [addingUrl, setAddingUrl] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  const handleTrack = async (query: string) => {
    setTracked((prev) => ({ ...prev, [query]: { status: "searching", groups: [] } }))
    try {
      const res = await fetch("/api/groups/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, location }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTracked((prev) => ({
          ...prev,
          [query]: { status: "error", groups: [], error: data.error || "Search failed" },
        }))
        return
      }
      setTracked((prev) => ({ ...prev, [query]: { status: "done", groups: data } }))
    } catch {
      setTracked((prev) => ({
        ...prev,
        [query]: { status: "error", groups: [], error: "Couldn't reach the server — try again." },
      }))
    }
  }

  const handleAdd = async (group: FoundGroup) => {
    setAddingUrl(group.url)
    setAddError(null)
    try {
      const result = await addSource(group)
      if (result.ok) {
        setAddedUrls((prev) => new Set(prev).add(group.url))
        // Monitored Sources lives on this same page and is server-rendered, so
        // without this the row goes into the database and nothing visibly
        // happens — which reads as a button that doesn't work.
        router.refresh()
      } else {
        setAddError(result.error)
      }
    } finally {
      setAddingUrl(null)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuggestions(null)
    setTracked({})
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
      {addError && <p className="text-sm text-destructive">{addError}</p>}

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
            These are suggested names, not confirmed groups. <strong>Track</strong> looks each one up
            on Facebook for real (5 credits) and lets you add what it finds to your monitored
            sources; <strong>Search</strong> just opens Facebook so you can browse yourself. Either
            way you still have to join — you can only see posts in groups you&apos;re a member of.
          </p>
          <div className="flex flex-col gap-2">
            {suggestions.map((s, i) => {
              const track = tracked[s.query]
              return (
                <div
                  key={`${s.query}-${i}`}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-4">
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
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="brand"
                        className="h-7 px-2.5 text-[0.8rem]"
                        onClick={() => handleTrack(s.query)}
                        disabled={track?.status === "searching"}
                      >
                        {track?.status === "searching" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Radar className="h-3 w-3" />
                        )}
                        {track?.status === "searching" ? "Finding…" : "Track"}
                      </Button>
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
                  </div>

                  {track?.status === "error" && (
                    <p className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                      {track.error}
                    </p>
                  )}

                  {track?.status === "done" && track.groups.length === 0 && (
                    <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                      Facebook has no group by that name. It was a suggestion, not a group we&apos;d
                      confirmed exists — try the Search button and pick a close match yourself.
                    </p>
                  )}

                  {track?.status === "done" && track.groups.length > 0 && (
                    <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
                      {track.groups.slice(0, 5).map((g) => {
                        const added = addedUrls.has(g.url)
                        return (
                          <div key={g.url} className="flex items-center justify-between gap-3 text-xs">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">{g.name}</span>
                              {g.joined ? (
                                <Badge
                                  variant="secondary"
                                  className="shrink-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                >
                                  <Check className="h-3 w-3" />
                                  Joined
                                </Badge>
                              ) : (
                                <Badge
                                  variant="secondary"
                                  className="shrink-0 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                >
                                  <CircleAlert className="h-3 w-3" />
                                  Not joined
                                </Badge>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {!g.joined && (
                                <a
                                  href={g.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex h-6 items-center gap-1 rounded-md border border-border px-2 font-medium transition-colors hover:bg-muted"
                                >
                                  Join
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              <Button
                                size="sm"
                                variant={added ? "secondary" : "outline"}
                                className="h-6 px-2 text-xs"
                                onClick={() => handleAdd(g)}
                                disabled={added || addingUrl === g.url}
                              >
                                {added ? (
                                  <>
                                    <Check className="h-3 w-3" />
                                    Tracking
                                  </>
                                ) : (
                                  <>
                                    <Plus className="h-3 w-3" />
                                    {addingUrl === g.url ? "Adding…" : "Track this"}
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                      {track.groups.some((g) => !g.joined) && (
                        <p className="pt-1 text-xs text-muted-foreground">
                          You can track a group before joining it, but Facebook only shows posts to
                          members — it will collect nothing until you&apos;re in.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
