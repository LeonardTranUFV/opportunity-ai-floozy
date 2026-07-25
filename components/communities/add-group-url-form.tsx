"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus } from "lucide-react"

function detectPlatform(rawUrl: string): "facebook" | "linkedin" | "nextdoor" | "twitter" | null {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, "")
  if (host === "facebook.com" || host === "fb.com") return "facebook"
  if (host === "linkedin.com") return "linkedin"
  if (host === "nextdoor.com") return "nextdoor"
  if (host === "x.com" || host === "twitter.com") return "twitter"
  return null
}

export function AddGroupUrlForm() {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const platform = detectPlatform(url)
    if (!platform) {
      setError(
        "That doesn't look like a Facebook, LinkedIn, Nextdoor, or X link. Paste a group/feed URL, e.g. https://www.facebook.com/groups/example, your Nextdoor neighborhood feed URL, or an X search URL like https://x.com/search?q=plumber%20recommendation&f=live"
      )
      return
    }

    if (!name.trim()) {
      setError("Give the group a name so you can recognize it in the list.")
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, name: name.trim(), url: url.trim(), active: true }),
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess(`Added "${data.name}" — it'll be scraped on the next run.`)
        setUrl("")
        setName("")
        router.refresh()
      } else if (res.status === 409) {
        setError("That group is already being tracked.")
      } else {
        setError(data.error || "Failed to add group")
      }
    } catch {
      setError("Failed to add group — check the server log.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-64 flex-1 flex-col gap-1.5">
          <Label htmlFor="group-url">Group link</Label>
          <Input
            id="group-url"
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setError(null)
              setSuccess(null)
            }}
            placeholder="Facebook/LinkedIn group, Nextdoor feed, or X search URL"
            required
          />
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor="group-name">Name</Label>
          <Input
            id="group-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
              setSuccess(null)
            }}
            placeholder="e.g. Vancouver Home Renovation, or My Neighborhood"
            required
          />
        </div>
        <Button type="submit" disabled={isSubmitting}>
          <Plus className="h-3.5 w-3.5" />
          {isSubmitting ? "Adding…" : "Add Group"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">{success}</p>}
    </form>
  )
}
