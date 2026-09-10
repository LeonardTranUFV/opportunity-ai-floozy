"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GroupName } from "@/components/communities/group-name"
import { GroupActiveToggle } from "@/components/communities/group-active-toggle"
import { DeleteGroupButton } from "@/components/communities/delete-group-button"
import { PLATFORM_META, PLATFORM_ORDER } from "@/lib/platform-meta"
import { readApiError, CONNECTION_ERROR } from "@/lib/format-error"
import { Play, Pause, Trash2, X } from "lucide-react"

/**
 * The sources list, with selection.
 *
 * Every action here already existed one row at a time. What did not exist was
 * doing it to twenty rows, and that is the shape of the work: somebody
 * recovering after the weekly resync paused everything, or clearing out the
 * nail-salon groups left over from a different line of business, has not made
 * twenty decisions. They made one.
 *
 * Selection lives in local state because it is genuinely local — it means
 * nothing once the page reloads, and it has to be cleared whenever the rows
 * underneath change, which router.refresh() gives us for free.
 */

export interface SourceRow {
  id: string
  platform: string
  name: string
  url: string
  active: boolean
  needs_membership: boolean | null
  post_count: number
}

type Action = "activate" | "pause" | "delete"

export function SourceList({
  groups,
  overCapIds,
  capacityLimit,
}: {
  groups: SourceRow[]
  overCapIds: string[]
  capacityLimit: number
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const overCap = new Set(overCapIds)

  const byPlatform = new Map<string, SourceRow[]>()
  for (const g of groups) {
    const list = byPlatform.get(g.platform) ?? []
    list.push(g)
    byPlatform.set(g.platform, list)
  }
  const sections = [
    ...PLATFORM_ORDER.filter((p) => byPlatform.has(p)),
    ...[...byPlatform.keys()].filter((p) => !PLATFORM_ORDER.includes(p)),
  ]

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })

  const run = (action: Action) => {
    const ids = [...selected]
    if (!ids.length) return
    if (
      action === "delete" &&
      !confirm(
        `Delete ${ids.length} source${ids.length === 1 ? "" : "s"}? Posts already collected from them are kept.`
      )
    ) {
      return
    }
    setError(null)
    setNotice(null)
    startTransition(async () => {
      try {
        const res = await fetch("/api/groups/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, action }),
        })
        if (!res.ok) {
          setError(await readApiError(res, "Couldn't update those sources"))
          return
        }
        const data = (await res.json()) as { message?: string | null }
        // The server's own words when it had to leave some paused. The plan
        // limit is the likeliest reason, and that message says what to do next.
        if (data.message) setNotice(data.message)
        setSelected(new Set())
        router.refresh()
      } catch {
        setError(CONNECTION_ERROR)
      }
    })
  }

  const allIds = groups.map((g) => g.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))

  return (
    <div className="flex flex-col gap-3">
      {/* Always rendered, so the checkboxes have an explanation before anything
          is ticked and the action row does not appear from nowhere. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer accent-brand"
            checked={allSelected}
            onChange={(e) => setMany(allIds, e.target.checked)}
            aria-label="Select all sources"
          />
          <span className="font-medium">{selected.size > 0 ? `${selected.size} selected` : "Select all"}</span>
        </label>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="xs" disabled={pending} onClick={() => run("activate")}>
              <Play className="h-3 w-3" />
              Resume
            </Button>
            <Button variant="outline" size="xs" disabled={pending} onClick={() => run("pause")}>
              <Pause className="h-3 w-3" />
              Pause
            </Button>
            <Button variant="destructive" size="xs" disabled={pending} onClick={() => run("delete")}>
              <Trash2 className="h-3 w-3" />
              Delete
            </Button>
            <Button variant="ghost" size="xs" disabled={pending} onClick={() => setSelected(new Set())}>
              <X className="h-3 w-3" />
              Clear
            </Button>
          </div>
        )}
      </div>

      {notice && <p className="text-xs text-amber-600 dark:text-amber-400">{notice}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-col gap-5">
        {sections.map((platform) => {
          const meta = PLATFORM_META[platform]
          const rows = byPlatform.get(platform)!
          const ids = rows.map((g) => g.id)
          const allOn = ids.every((id) => selected.has(id))
          return (
            <div key={platform} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-brand"
                  checked={allOn}
                  onChange={(e) => setMany(ids, e.target.checked)}
                  aria-label={`Select all ${meta?.label ?? platform} sources`}
                />
                {meta ? (
                  <div
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${meta.iconColor}`}
                  >
                    <meta.Icon className="h-3.5 w-3.5" />
                  </div>
                ) : null}
                <span className="text-sm font-semibold capitalize">{meta?.label ?? platform}</span>
                <span className="text-xs text-muted-foreground">
                  {rows.length} source{rows.length === 1 ? "" : "s"}
                </span>
              </div>

              {rows.map((g) => (
                <div
                  key={g.id}
                  className={`flex items-center justify-between gap-4 rounded-lg border p-3 transition-colors ${
                    selected.has(g.id)
                      ? "border-brand/50 bg-brand/[0.06]"
                      : "border-border hover:border-brand/30 hover:bg-brand/[0.03]"
                  }`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-brand"
                      checked={selected.has(g.id)}
                      onChange={() => toggle(g.id)}
                      aria-label={`Select ${g.name}`}
                    />
                    <div className="flex min-w-0 flex-col gap-1">
                      <GroupName id={g.id} name={g.name} url={g.url} />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={g.active ? "success" : "secondary"}>
                          {g.active ? "Active" : "Paused"}
                        </Badge>
                        {g.active && overCap.has(g.id) && (
                          <Badge
                            variant="warning"
                            title={`Your plan reads ${capacityLimit} sources at a time, oldest first. This one is outside that, so nothing is collected from it until you pause another.`}
                          >
                            Over limit — not being read
                          </Badge>
                        )}
                        {g.needs_membership === true && (
                          <Badge
                            variant="warning"
                            title="This group only shows its posts to members, so nothing can be collected until the connected account joins it."
                          >
                            Join this group to find opportunities
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{g.post_count} posts collected</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <GroupActiveToggle id={g.id} active={g.active} />
                    <DeleteGroupButton id={g.id} name={g.name} />
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
