"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { addSource } from "@/lib/add-source"
import { Search, Plus, ExternalLink, ChevronDown, Check, CircleAlert } from "lucide-react"

interface DiscoveredGroup {
  name: string
  url: string
  platform: string
  description: string
  /**
   * Whether the connected Facebook account is already a member. The search
   * has always returned this and this form used to discard it — which made
   * "Add" feel effortless right up until the group collected nothing, because
   * Facebook only serves posts to members. Surfacing it is the difference
   * between a source that works and one that is silently dead.
   */
  joined?: boolean
}

export function DiscoverGroupsForm() {
  const router = useRouter()
  const [industry, setIndustry] = useState("")
  const [location, setLocation] = useState("")
  const [results, setResults] = useState<DiscoveredGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set())
  const [isSearching, startSearch] = useTransition()
  const [addingUrl, setAddingUrl] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResults(null)
    setExhausted(false)
    startSearch(async () => {
      try {
        const res = await fetch("/api/groups/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ industry, location }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || "Discovery failed")
          return
        }
        setResults(data)
      } catch {
        setError("Discovery failed — check the server log.")
      }
    })
  }

  // Sends back everything already on screen so the crawler scrolls deeper and
  // returns groups the user hasn't seen, instead of repeating the first page.
  const handleLoadMore = async () => {
    if (!results) return
    setLoadingMore(true)
    setError(null)
    try {
      const res = await fetch("/api/groups/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry, location, exclude: results.map((r) => r.url) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Couldn't load more")
        return
      }
      if (!Array.isArray(data) || data.length === 0) {
        setExhausted(true)
        return
      }
      setResults((prev) => [...(prev ?? []), ...data])
    } catch {
      setError("Couldn't load more — check the server log.")
    } finally {
      setLoadingMore(false)
    }
  }

  const handleAdd = async (group: DiscoveredGroup) => {
    setAddingUrl(group.url)
    setError(null)
    try {
      const result = await addSource(group)
      if (result.ok) {
        setAddedUrls((prev) => new Set(prev).add(group.url))
        router.refresh()
      } else {
        setError(result.error)
      }
    } finally {
      setAddingUrl(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="industry">Industry</Label>
          <Input
            id="industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. Roofing"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Vancouver"
            required
          />
        </div>
        <Button type="submit" disabled={isSearching}>
          <Search className="h-3.5 w-3.5" />
          {isSearching ? "Searching Facebook…" : "Discover Groups (5 credits)"}
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {results && results.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          No groups found for that search. Try a broader industry or location — or check that
          you&apos;re actually logged in under{" "}
          <a href="/accounts" className="underline">
            Connect Accounts
          </a>
          , since discovery only works while your Facebook session is authenticated.
        </p>
      )}

      {results && results.length > 0 && (
        <div className="flex flex-col gap-2">
          {results.map((g) => (
            <div key={g.url} className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{g.name}</span>
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
                <span className="line-clamp-2 text-xs text-muted-foreground">{g.description}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={g.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted"
                >
                  {g.joined ? "View" : "Join"}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={addedUrls.has(g.url) || addingUrl === g.url}
                  onClick={() => handleAdd(g)}
                >
                  {addedUrls.has(g.url) ? (
                    "Added"
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      {addingUrl === g.url ? "Adding…" : "Add"}
                    </>
                  )}
                </Button>
              </div>
            </div>
          ))}

          {results.some((g) => !g.joined) && (
            <p className="text-xs text-muted-foreground">
              You can add a group before joining it, but Facebook only shows posts to members — a
              group you haven&apos;t joined will collect nothing until you&apos;re in.
            </p>
          )}

          {exhausted ? (
            <p className="text-sm text-muted-foreground">
              That&apos;s everything Facebook returned for this search. Try a different industry or a
              nearby town to surface more.
            </p>
          ) : (
            <Button variant="outline" size="sm" className="w-fit" onClick={handleLoadMore} disabled={loadingMore}>
              <ChevronDown className="h-3.5 w-3.5" />
              {loadingMore ? "Searching deeper…" : "See more groups (5 credits)"}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
