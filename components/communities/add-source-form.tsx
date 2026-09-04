"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MapPin, Plus, Search, Store as StoreIcon } from "lucide-react"
import { FacebookIcon, LinkedInIcon, NextdoorIcon, XIcon, RedditIcon } from "@/components/icons"
import { readApiError, CONNECTION_ERROR } from "@/lib/format-error"

type Platform = "facebook" | "marketplace" | "linkedin" | "nextdoor" | "twitter" | "reddit"

const PLATFORM_TABS: {
  id: Platform
  label: string
  // Loosened from `typeof FacebookIcon` so Lucide icons work here too — the
  // in-house brand icons and Lucide both just take a className.
  Icon: React.ComponentType<{ className?: string }>
  activeClass: string
}[] = [
  { id: "facebook", label: "Facebook", Icon: FacebookIcon, activeClass: "bg-[#1877F2] text-white hover:bg-[#1877F2]/90" },
  { id: "marketplace", label: "Marketplace", Icon: StoreIcon, activeClass: "bg-[#1877F2] text-white hover:bg-[#1877F2]/90" },
  { id: "linkedin", label: "LinkedIn", Icon: LinkedInIcon, activeClass: "bg-[#0A66C2] text-white hover:bg-[#0A66C2]/90" },
  { id: "nextdoor", label: "Nextdoor", Icon: NextdoorIcon, activeClass: "bg-[#8fca43] text-white hover:bg-[#8fca43]/90" },
  { id: "twitter", label: "X", Icon: XIcon, activeClass: "bg-black text-white hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/85" },
  { id: "reddit", label: "Reddit", Icon: RedditIcon, activeClass: "bg-orange-600 text-white hover:bg-orange-600/90" },
]

const PLATFORM_HOSTS: Record<Platform, string[]> = {
  facebook: ["facebook.com", "fb.com"],
  marketplace: ["facebook.com", "fb.com"],
  linkedin: ["linkedin.com"],
  nextdoor: ["nextdoor.com"],
  twitter: ["x.com", "twitter.com"],
  reddit: ["reddit.com"],
}

function hostMatches(rawUrl: string, platform: Platform): boolean {
  try {
    const host = new URL(rawUrl.trim()).hostname.replace(/^www\./, "")
    return PLATFORM_HOSTS[platform].includes(host)
  } catch {
    return false
  }
}

async function addGroup(platform: Platform, name: string, url: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, name, url, active: true }),
    })
    if (res.ok) return { ok: true }
    // The server's sentence first. 409 used to be assumed to mean "already
    // tracked", but the monitored-source limit answers 409 too — and telling
    // someone at their limit that the source already exists sends them
    // looking for a duplicate that isn't there.
    return { ok: false, error: await readApiError(res, "Couldn't add that source") }
  } catch {
    return { ok: false, error: CONNECTION_ERROR }
  }
}

export function AddSourceForm() {
  const router = useRouter()
  const [platform, setPlatform] = useState<Platform>("facebook")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Facebook / LinkedIn / "another neighborhood" fields
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  // X keyword field
  const [keyword, setKeyword] = useState("")
  const [marketplaceCity, setMarketplaceCity] = useState("")
  // Nextdoor advanced toggle
  const [showAnotherNeighborhood, setShowAnotherNeighborhood] = useState(false)
  // Reddit fields
  const [redditQuery, setRedditQuery] = useState("")
  const [subreddit, setSubreddit] = useState("")
  const [showSubreddit, setShowSubreddit] = useState(false)

  const resetMessages = () => {
    setError(null)
    setSuccess(null)
  }

  const switchPlatform = (p: Platform) => {
    setPlatform(p)
    setUrl("")
    setName("")
    setKeyword("")
    setShowAnotherNeighborhood(false)
    setRedditQuery("")
    setSubreddit("")
    setShowSubreddit(false)
    resetMessages()
  }

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    resetMessages()

    if (!hostMatches(url, platform)) {
      const label = PLATFORM_TABS.find((t) => t.id === platform)!.label
      setError(`That doesn't look like a ${label} link. Paste the full URL, e.g. https://${PLATFORM_HOSTS[platform][0]}/...`)
      return
    }
    if (!name.trim()) {
      setError("Give it a name so you can recognize it in the list.")
      return
    }

    setIsSubmitting(true)
    const result = await addGroup(platform, name.trim(), url.trim())
    setIsSubmitting(false)
    if (result.ok) {
      setSuccess(`Added "${name.trim()}" — it'll be checked on the next run.`)
      setUrl("")
      setName("")
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  const handleAddMyNeighborhood = async () => {
    resetMessages()
    setIsSubmitting(true)
    const result = await addGroup("nextdoor", "My Neighborhood", "https://nextdoor.com/news_feed/")
    setIsSubmitting(false)
    if (result.ok) {
      setSuccess(`Added "My Neighborhood" — it'll be checked on the next run.`)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  const handleMarketplaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    resetMessages()
    const term = keyword.trim()
    const city = marketplaceCity.trim()
    if (!term) {
      setError('Enter what to watch for, e.g. "ISO handyman" or "help needed".')
      return
    }
    if (!city) {
      setError('Enter a city, e.g. "vancouver" — Marketplace results are always location-scoped.')
      return
    }

    // Marketplace search is city-scoped in the path, not a query param.
    const slug = city.toLowerCase().replace(/[^a-z0-9]+/g, "")
    const searchUrl = `https://www.facebook.com/marketplace/${slug}/search?query=${encodeURIComponent(term)}`
    setIsSubmitting(true)
    const result = await addGroup("marketplace", `${term} · ${city}`, searchUrl)
    setIsSubmitting(false)
    if (result.ok) {
      setSuccess(`Added "${term}" in ${city} — it'll be checked on the next run.`)
      setKeyword("")
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  const handleKeywordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    resetMessages()
    if (!keyword.trim()) {
      setError("Enter a keyword or phrase to search for, e.g. \"plumber recommendation Vancouver\".")
      return
    }

    const searchUrl = `https://x.com/search?q=${encodeURIComponent(keyword.trim())}&f=live`
    setIsSubmitting(true)
    const result = await addGroup("twitter", keyword.trim(), searchUrl)
    setIsSubmitting(false)
    if (result.ok) {
      setSuccess(`Added "${keyword.trim()}" — it'll be checked on the next run.`)
      setKeyword("")
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  const handleRedditSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    resetMessages()
    if (!redditQuery.trim()) {
      setError("Enter a keyword or phrase to search all of Reddit for.")
      return
    }
    const searchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(redditQuery.trim())}`
    setIsSubmitting(true)
    const result = await addGroup("reddit", redditQuery.trim(), searchUrl)
    setIsSubmitting(false)
    if (result.ok) {
      setSuccess(`Added "${redditQuery.trim()}" — it'll be checked on the next run.`)
      setRedditQuery("")
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  const handleSubredditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    resetMessages()
    const clean = subreddit.trim().replace(/^\/?r\//i, "")
    if (!clean || /\s/.test(clean)) {
      setError("Enter just the subreddit name, e.g. \"roofing\" (no spaces, no r/ needed).")
      return
    }
    const subUrl = `https://www.reddit.com/r/${clean}/`
    setIsSubmitting(true)
    const result = await addGroup("reddit", `r/${clean}`, subUrl)
    setIsSubmitting(false)
    if (result.ok) {
      setSuccess(`Added "r/${clean}" — it'll be checked on the next run.`)
      setSubreddit("")
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {PLATFORM_TABS.map((tab) => (
          <Button
            key={tab.id}
            type="button"
            size="sm"
            variant="outline"
            className={platform === tab.id ? tab.activeClass : ""}
            onClick={() => tab.id !== "reddit" && switchPlatform(tab.id)}
            disabled={tab.id === "reddit"}
            title={tab.id === "reddit" ? "Coming soon — Reddit isn't wired up yet" : undefined}
          >
            <tab.Icon className="h-3.5 w-3.5" />
            {tab.label}
            {tab.id === "reddit" && <span className="text-[10px] text-muted-foreground">(soon)</span>}
          </Button>
        ))}
      </div>

      {(platform === "facebook" || platform === "linkedin") && (
        <form onSubmit={handleUrlSubmit} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:min-w-64 sm:flex-1">
              <Label htmlFor="source-url">Group link</Label>
              <Input
                id="source-url"
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  resetMessages()
                }}
                placeholder={`https://www.${PLATFORM_HOSTS[platform][0]}/groups/example`}
                required
              />
            </div>
            <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:min-w-48 sm:flex-1">
              <Label htmlFor="source-name">Name</Label>
              <Input
                id="source-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  resetMessages()
                }}
                placeholder="e.g. Vancouver Home Renovation"
                required
              />
            </div>
            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              <Plus className="h-3.5 w-3.5" />
              {isSubmitting ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      )}

      {platform === "nextdoor" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handleAddMyNeighborhood} disabled={isSubmitting}>
              <MapPin className="h-3.5 w-3.5" />
              {isSubmitting ? "Adding…" : "Add My Neighborhood"}
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => setShowAnotherNeighborhood((v) => !v)}
            >
              {showAnotherNeighborhood ? "Hide" : "Have another verified neighborhood?"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Nextdoor only shows content for neighborhoods tied to a verified address on your account —
            there&apos;s no way to browse other areas without being verified there. If your account
            covers more than one neighborhood (common for contractors/agents), add each one below.
          </p>
          {showAnotherNeighborhood && (
            <form onSubmit={handleUrlSubmit} className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
              <div className="flex min-w-64 flex-1 flex-col gap-1.5">
                <Label htmlFor="source-url">Neighborhood feed link</Label>
                <Input
                  id="source-url"
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value)
                    resetMessages()
                  }}
                  placeholder="https://nextdoor.com/news_feed/?..."
                  required
                />
              </div>
              <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                <Label htmlFor="source-name">Name</Label>
                <Input
                  id="source-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    resetMessages()
                  }}
                  placeholder="e.g. Surrey Neighborhood"
                  required
                />
              </div>
              <Button type="submit" disabled={isSubmitting}>
                <Plus className="h-3.5 w-3.5" />
                {isSubmitting ? "Adding…" : "Add"}
              </Button>
            </form>
          )}
        </div>
      )}

      {platform === "marketplace" && (
        <form onSubmit={handleMarketplaceSubmit} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-56 flex-1 flex-col gap-1.5">
              <Label htmlFor="mp-keyword">What are you watching for?</Label>
              <Input
                id="mp-keyword"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value)
                  resetMessages()
                }}
                placeholder='e.g. ISO handyman, help needed, house for sale'
                required
              />
            </div>
            <div className="flex w-44 flex-col gap-1.5">
              <Label htmlFor="mp-city">City</Label>
              <Input
                id="mp-city"
                value={marketplaceCity}
                onChange={(e) => {
                  setMarketplaceCity(e.target.value)
                  resetMessages()
                }}
                placeholder="e.g. Vancouver"
                required
              />
            </div>
            <Button type="submit" disabled={isSubmitting}>
              <Search className="h-3.5 w-3.5" />
              {isSubmitting ? "Adding…" : "Add"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Uses your Facebook login — no separate connection needed. Marketplace is mostly people
            <em> selling</em>, so search the way a customer would post: &ldquo;ISO&rdquo;, &ldquo;looking
            for&rdquo;, &ldquo;help needed&rdquo;. The AI still scores each listing, so ads from other
            businesses get filtered out.
          </p>
        </form>
      )}

      {platform === "twitter" && (
        <form onSubmit={handleKeywordSubmit} className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-64 flex-1 flex-col gap-1.5">
            <Label htmlFor="source-keyword">What are you looking for?</Label>
            <Input
              id="source-keyword"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value)
                resetMessages()
              }}
              placeholder="e.g. plumber recommendation Vancouver"
              required
            />
          </div>
          <Button type="submit" disabled={isSubmitting}>
            <Search className="h-3.5 w-3.5" />
            {isSubmitting ? "Adding…" : "Add"}
          </Button>
        </form>
      )}

      {platform === "reddit" && (
        <div className="flex flex-col gap-3">
          <form onSubmit={handleRedditSearchSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-64 flex-1 flex-col gap-1.5">
              <Label htmlFor="reddit-query">Search all of Reddit for</Label>
              <Input
                id="reddit-query"
                value={redditQuery}
                onChange={(e) => {
                  setRedditQuery(e.target.value)
                  resetMessages()
                }}
                placeholder="e.g. need a roofer Vancouver"
                required
              />
            </div>
            <Button type="submit" disabled={isSubmitting}>
              <Search className="h-3.5 w-3.5" />
              {isSubmitting ? "Adding…" : "Add"}
            </Button>
          </form>
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => setShowSubreddit((v) => !v)}
          >
            {showSubreddit ? "Hide" : "Or watch a specific subreddit"}
          </button>
          {showSubreddit && (
            <form onSubmit={handleSubredditSubmit} className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
              <div className="flex min-w-64 flex-1 flex-col gap-1.5">
                <Label htmlFor="subreddit">Subreddit name</Label>
                <Input
                  id="subreddit"
                  value={subreddit}
                  onChange={(e) => {
                    setSubreddit(e.target.value)
                    resetMessages()
                  }}
                  placeholder="e.g. VancouverIsAwesome"
                  required
                />
              </div>
              <Button type="submit" disabled={isSubmitting}>
                <Plus className="h-3.5 w-3.5" />
                {isSubmitting ? "Adding…" : "Add"}
              </Button>
            </form>
          )}
          <p className="text-xs text-muted-foreground">
            Reddit access is still being wired up on the backend — adding a source here works, but
            monitoring it won&apos;t return posts yet.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">{success}</p>}
    </div>
  )
}
