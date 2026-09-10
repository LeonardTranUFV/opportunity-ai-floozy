"use client"

import { useState, useSyncExternalStore, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GroupName } from "@/components/communities/group-name"
import { GroupActiveToggle } from "@/components/communities/group-active-toggle"
import { DeleteGroupButton } from "@/components/communities/delete-group-button"
import { PLATFORM_META, PLATFORM_ORDER } from "@/lib/platform-meta"
import { sessionPlatform } from "@/lib/session-platform"
import { readApiError, CONNECTION_ERROR } from "@/lib/format-error"
import { Play, Pause, Trash2, X, ChevronDown, ChevronRight } from "lucide-react"

/**
 * The sources list: selection, and a collapsible section per platform.
 *
 * Both exist for the same reason. One account here has 36 Facebook groups and
 * one Nextdoor feed, so everything that is not Facebook is below the fold and
 * effectively invisible — you cannot tell at a glance whether Nextdoor is
 * connected or collecting anything. Folding a platform shut turns it into one
 * line that still answers those questions, which is the point: collapsed must
 * not mean hidden.
 *
 * Selection is local state because it means nothing after a reload and has to
 * clear whenever the rows change, which router.refresh() gives us for free.
 * Collapse is the opposite — it is a preference, so it persists.
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

const STORAGE_KEY = "sources.collapsed"

/**
 * Sections big enough to bury everything under them start folded.
 *
 * Only until someone expresses a preference — after that their choice is
 * restored and this is never consulted again. Ten is chosen to be past any
 * plan's source limit for a single platform being *usefully* scannable in one
 * screen, not as a magic number: below it the list is readable, above it the
 * platform below is off the bottom of the page.
 */
const AUTO_FOLD_ABOVE = 10

/**
 * localStorage read as an external store rather than copied into state by an
 * effect.
 *
 * The effect version needs setState on mount, which trips
 * react-hooks/set-state-in-effect and, more to the point, renders one frame of
 * the wrong answer before correcting itself. useSyncExternalStore returns the
 * server snapshot during hydration and the real value immediately after, which
 * is exactly the semantics wanted here — and the storage event means a change
 * made in another tab lands in this one too.
 */
function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange)
  return () => window.removeEventListener("storage", onChange)
}

function readStoredCollapse(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Private mode or storage disabled. The computed default still applies.
    return null
  }
}

function parseCollapse(raw: string | null): Set<string> | null {
  if (!raw) return null
  try {
    const list: unknown = JSON.parse(raw)
    return Array.isArray(list) ? new Set(list.filter((p): p is string => typeof p === "string")) : null
  } catch {
    return null
  }
}

export function SourceList({
  groups,
  overCapIds,
  capacityLimit,
  connectedPlatforms,
}: {
  groups: SourceRow[]
  overCapIds: string[]
  capacityLimit: number
  connectedPlatforms: string[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const overCap = new Set(overCapIds)
  const connected = new Set(connectedPlatforms)

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

  // Three layers, most specific first: what was clicked this session, what was
  // stored previously, and the computed default for a first visit. Derived
  // during render rather than copied into state, so the server render and the
  // hydrated one agree.
  const storedRaw = useSyncExternalStore(subscribeToStorage, readStoredCollapse, () => null)
  const [override, setOverride] = useState<Set<string> | null>(null)
  const collapsed =
    override ??
    parseCollapse(storedRaw) ??
    new Set(sections.filter((p) => (byPlatform.get(p)?.length ?? 0) > AUTO_FOLD_ABOVE))

  const toggleSection = (platform: string) => {
    const next = new Set(collapsed)
    if (next.has(platform)) next.delete(platform)
    else next.add(platform)
    setOverride(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
    } catch {
      // Not being able to remember the preference is no reason to refuse to
      // apply it now.
    }
  }

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

      <div className="flex flex-col gap-4">
        {sections.map((platform) => {
          const meta = PLATFORM_META[platform]
          const rows = byPlatform.get(platform)!
          const ids = rows.map((g) => g.id)
          const allOn = ids.every((id) => selected.has(id))
          const isShut = collapsed.has(platform)
          const activeCount = rows.filter((g) => g.active).length
          const postCount = rows.reduce((n, g) => n + g.post_count, 0)

          // Marketplace has no login of its own — it rides on Facebook's.
          const needsAccount = meta?.needsAccount ?? true
          const isConnected = connected.has(sessionPlatform(platform))

          return (
            <div key={platform} className="flex flex-col gap-2">
              {/* The summary line is the whole point of folding: shut, this
                  still says whether the platform is connected and how much it
                  has collected. */}
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 cursor-pointer accent-brand"
                  checked={allOn}
                  onChange={(e) => setMany(ids, e.target.checked)}
                  aria-label={`Select all ${meta?.label ?? platform} sources`}
                />
                <button
                  type="button"
                  onClick={() => toggleSection(platform)}
                  aria-expanded={!isShut}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                >
                  {isShut ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  {meta ? (
                    <div
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${meta.iconColor}`}
                    >
                      <meta.Icon className="h-3.5 w-3.5" />
                    </div>
                  ) : null}
                  <span className="shrink-0 text-sm font-semibold capitalize">{meta?.label ?? platform}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {rows.length} source{rows.length === 1 ? "" : "s"} · {activeCount} active ·{" "}
                    {postCount.toLocaleString()} post{postCount === 1 ? "" : "s"}
                  </span>
                </button>

                {!needsAccount ? (
                  <Badge variant="secondary" title="This source type is read over plain HTTP — nothing to connect.">
                    No login needed
                  </Badge>
                ) : isConnected ? (
                  <Badge variant="success">Connected</Badge>
                ) : (
                  <Badge
                    variant="warning"
                    title="No saved login for this platform, so nothing can be collected from these sources. Connect it under Connect Accounts."
                  >
                    Not connected
                  </Badge>
                )}
              </div>

              {!isShut &&
                rows.map((g) => (
                  <div
                    key={g.id}
                    className={`ml-0 flex items-center justify-between gap-4 rounded-lg border p-3 transition-colors sm:ml-6 ${
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

      {collapsed.size > 0 && (
        <p className="text-xs text-muted-foreground">
          {collapsed.size} platform{collapsed.size === 1 ? "" : "s"} folded — click a heading to open it.
        </p>
      )}
    </div>
  )
}
