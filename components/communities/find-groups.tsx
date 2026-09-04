"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { addSource } from "@/lib/add-source"
import {
  Search,
  Plus,
  ExternalLink,
  ChevronDown,
  Check,
  CircleAlert,
  Sparkles,
  Loader2,
} from "lucide-react"

/**
 * One flow for finding groups to monitor.
 *
 * This replaces two cards that were really one flow cut in half: an AI card
 * that invented search phrases and then ran a Facebook search for each, and a
 * search card that ran the same Facebook search directly. Same endpoint, same
 * results, same Add button — the second card was just the first card's second
 * step, exposed on its own.
 *
 * Splitting them cost real money. Every search is 5 credits and one slot
 * against a 5-per-15-minutes browser limit, and the AI card rendered a Track
 * button per suggestion — so working down a list of ten hit the rate limit at
 * click five with half the suggestions untried. Here the search is the primary
 * action and the AI is an optional assist that fills it in, so a session is one
 * search, not five.
 */

interface Suggestion {
  query: string
  category: string
  why: string
}

/**
 * `visibility`, not `joined`, is what decides whether a group will produce
 * anything. A public group serves its posts to anyone; only a private group
 * requires membership. The app used to claim the opposite — "Facebook only
 * shows posts to members" — and the data disagrees: thirteen unjoined public
 * groups added on 2026-08-09 returned 4-14 posts each on the next scrape.
 *
 * So "Not joined" is only a warning when the group is private. On a public
 * group it's a neutral fact worth showing (joining still gets you posting
 * rights and a better feed), and flagging it as a problem sends people off to
 * request membership they don't need.
 */
interface FoundGroup {
  name: string
  url: string
  platform: string
  description: string
  joined?: boolean
  visibility?: "public" | "private" | null
}

const CATEGORY_TONE: Record<string, string> = {
  Neighbourhood: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "Buy & sell": "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  Homeowners: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  Community: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  Trade: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
}

export function FindGroups({
  /**
   * No signed-in browser is reachable from this deployment, so Facebook search
   * cannot run at all. Previously this prop was `hosted`, which conflated
   * "we're on Vercel" with "there is no browser" — true until the crawler
   * learned to rent one, and misleading afterwards: the feature worked and the
   * button was still disabled.
   */
  noBrowser = false,
  defaultLocation = "",
}: {
  noBrowser?: boolean
  defaultLocation?: string
}) {
  const router = useRouter()
  const [industry, setIndustry] = useState("")
  const [location, setLocation] = useState(defaultLocation)

  const [results, setResults] = useState<FoundGroup[] | null>(null)
  const [searchedFor, setSearchedFor] = useState<string | null>(null)
  const [lastPayload, setLastPayload] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSearching, startSearch] = useTransition()
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  const [showSuggest, setShowSuggest] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [isSuggesting, startSuggest] = useTransition()

  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set())
  const [addingUrl, setAddingUrl] = useState<string | null>(null)

  const runSearch = (payload: Record<string, unknown>, label: string) => {
    setError(null)
    setResults(null)
    setExhausted(false)
    setSearchedFor(label)
    setLastPayload(payload)
    startSearch(async () => {
      try {
        const res = await fetch("/api/groups/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || "Search failed")
          setSearchedFor(null)
          return
        }
        setResults(data)
      } catch {
        setError("Couldn't reach the server — try again.")
        setSearchedFor(null)
      }
    })
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    runSearch({ industry, location }, `${industry} in ${location}`)
  }

  const handleSuggest = () => {
    setError(null)
    setSuggestions(null)
    startSuggest(async () => {
      try {
        const res = await fetch("/api/groups/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trade: industry, location }),
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

  // A suggestion already names its own area ("Burnaby Community Notice Board"),
  // so it goes through as an exact query rather than being concatenated with
  // the location field again.
  const handleUseSuggestion = (s: Suggestion) => runSearch({ query: s.query, location }, s.query)

  // Sends back everything already on screen so the crawler scrolls deeper and
  // returns groups the user hasn't seen, instead of repeating the first page.
  const handleLoadMore = async () => {
    if (!results || !lastPayload) return
    setLoadingMore(true)
    setError(null)
    try {
      const res = await fetch("/api/groups/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...lastPayload, exclude: results.map((r) => r.url) }),
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
      setError("Couldn't load more — try again.")
    } finally {
      setLoadingMore(false)
    }
  }

  const handleAdd = async (group: FoundGroup) => {
    setAddingUrl(group.url)
    setError(null)
    try {
      const result = await addSource(group)
      if (result.ok) {
        setAddedUrls((prev) => new Set(prev).add(group.url))
        // Monitored Sources is server-rendered further down this same page —
        // without this the row lands in the database and nothing visibly
        // happens, which reads as a button that doesn't work.
        router.refresh()
      } else {
        setError(result.error)
      }
    } finally {
      setAddingUrl(null)
    }
  }

  const canSearch = industry.trim() !== "" && location.trim() !== ""

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-40 flex-1 flex-col gap-1.5">
          <Label htmlFor="fg-industry">What do you do?</Label>
          <Input
            id="fg-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. Roofing"
            required
          />
        </div>
        <div className="flex min-w-40 flex-1 flex-col gap-1.5">
          <Label htmlFor="fg-location">Where do you work?</Label>
          <Input
            id="fg-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Vancouver"
            required
          />
        </div>
        <Button type="submit" variant="brand" disabled={isSearching || noBrowser}>
          {isSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {isSearching ? "Searching Facebook…" : "Find groups (5 credits)"}
        </Button>
      </form>

      {/* Telling a customer to "run the app locally" is a dead end — they
          can't, and it left this card with no next step. Reddit is the one
          source type that collects anywhere, so send them there instead. */}
      {noBrowser ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Facebook search needs a signed-in browser, and none is set up on this deployment.{" "}
          <strong className="text-foreground">Reddit works right now</strong> — add a subreddit
          under &ldquo;Add a Source&rdquo; below and it starts collecting posts immediately, with no
          account to connect and nothing to join.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => setShowSuggest((v) => !v)}
          >
            {showSuggest ? "Hide suggestions" : "Not sure what to search for?"}
          </button>
          <span className="text-xs text-muted-foreground">
            Searches Facebook live using your saved session — can take up to 20 seconds.
          </span>
        </div>
      )}

      {showSuggest && !noBrowser && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleSuggest}
              disabled={isSuggesting || !canSearch}
            >
              {isSuggesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {isSuggesting ? "Thinking…" : "Suggest searches"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {canSearch
                ? "Free — the AI proposes phrases; picking one runs the search above."
                : "Fill in both fields first."}
            </span>
          </div>

          {suggestions && suggestions.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No suggestions came back — try a broader trade or a larger nearby city.
            </p>
          )}

          {suggestions && suggestions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {suggestions.map((s, i) => (
                <div
                  key={`${s.query}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-2"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium">{s.query}</span>
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
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      onClick={() => handleUseSuggestion(s)}
                      disabled={isSearching}
                    >
                      <Search className="h-3 w-3" />
                      Search this
                    </Button>
                    <a
                      href={`https://www.facebook.com/search/groups/?q=${encodeURIComponent(s.query)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-6 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium transition-colors hover:bg-muted"
                      aria-label={`Open "${s.query}" on Facebook`}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                These are suggested phrases, not confirmed groups. Searching one looks it up on
                Facebook for real (5 credits).
              </p>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {results && results.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">
          Facebook returned nothing for &ldquo;{searchedFor}&rdquo;. Try a broader trade or a nearby
          town — or check you&apos;re still signed in under{" "}
          <a href="/accounts" className="underline">
            Connect Accounts
          </a>
          .
        </p>
      )}

      {results && results.length > 0 && (
        <div className="flex flex-col gap-2">
          {searchedFor && (
            <p className="text-xs text-muted-foreground">
              {results.length} group{results.length === 1 ? "" : "s"} for &ldquo;{searchedFor}&rdquo;
            </p>
          )}

          {results.map((g) => {
            const added = addedUrls.has(g.url)
            return (
              <div
                key={g.url}
                className="flex items-center justify-between gap-4 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{g.name}</span>
                    {g.joined && (
                      <Badge
                        variant="secondary"
                        className="shrink-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      >
                        <Check className="h-3 w-3" />
                        Joined
                      </Badge>
                    )}
                    {/* Only private + not joined is an actual problem. A public
                        group reads fine without membership, so badging it
                        amber would send people chasing approvals they don't
                        need. */}
                    {!g.joined && g.visibility === "private" && (
                      <Badge
                        variant="secondary"
                        className="shrink-0 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      >
                        <CircleAlert className="h-3 w-3" />
                        Private — join to read
                      </Badge>
                    )}
                    {!g.joined && g.visibility === "public" && (
                      <Badge variant="secondary" className="shrink-0 text-muted-foreground">
                        Public
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
                    variant={added ? "secondary" : "outline"}
                    size="sm"
                    disabled={added || addingUrl === g.url}
                    onClick={() => handleAdd(g)}
                  >
                    {added ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Tracking
                      </>
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5" />
                        {addingUrl === g.url ? "Adding…" : "Track"}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )
          })}

          {results.some((g) => !g.joined) && (
            <div className="flex flex-col gap-1 rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
              <p>
                <strong className="text-foreground">Reading and replying are different things.</strong>{" "}
                A public group is readable without joining, so tracking it starts collecting posts
                right away — but Facebook only lets <em>members</em> comment. The app still finds the
                lead and drafts your reply; you&apos;ll need to join the group before you can send it.
              </p>
              {results.some((g) => !g.joined && g.visibility === "private") && (
                <p>Private groups collect nothing at all until your join request is approved.</p>
              )}
            </div>
          )}

          {exhausted ? (
            <p className="text-sm text-muted-foreground">
              That&apos;s everything Facebook returned for this search. Try a different trade or a
              nearby town to surface more.
            </p>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              <ChevronDown className="h-3.5 w-3.5" />
              {loadingMore ? "Searching deeper…" : "See more groups (5 credits)"}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
