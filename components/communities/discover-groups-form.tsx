"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Search, Plus } from "lucide-react"

interface DiscoveredGroup {
  name: string
  url: string
  platform: string
  description: string
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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResults(null)
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

  const handleAdd = async (group: DiscoveredGroup) => {
    setAddingUrl(group.url)
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: group.platform, name: group.name, url: group.url, active: true }),
      })
      if (res.ok || res.status === 409) {
        setAddedUrls((prev) => new Set(prev).add(group.url))
        router.refresh()
      } else {
        const data = await res.json()
        alert(data.error || "Failed to add group")
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
          {isSearching ? "Searching Facebook…" : "Discover Groups"}
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
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{g.name}</span>
                <span className="text-xs text-muted-foreground">{g.description}</span>
              </div>
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
          ))}
        </div>
      )}
    </div>
  )
}
