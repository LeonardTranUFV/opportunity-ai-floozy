"use client"

import { useTransition } from "react"
import { useRouter, usePathname } from "next/navigation"
import { ListFilter, X, ArrowDownWideNarrow, RefreshCw } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { PLATFORM_META, PLATFORM_ORDER } from "@/lib/platform-meta"

export type SortOption = "relevance" | "newest" | "oldest" | "urgency" | "platform"

const PLATFORM_OPTIONS = [
  { value: "", label: "All Platforms" },
  ...PLATFORM_ORDER.map((p) => ({ value: p, label: PLATFORM_META[p].label })),
]

const URGENCY_OPTIONS = [
  { value: "", label: "All Urgency" },
  { value: "asap", label: "ASAP" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
]

const STATUS_OPTIONS = [
  { value: "", label: "All Status" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "appointment", label: "Appointment" },
  { value: "proposal", label: "Proposal" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
]

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "relevance", label: "Best Match" },
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "urgency", label: "Urgency: ASAP → Low" },
  { value: "platform", label: "Grouped by Platform" },
]

export function FilterBar({
  agents,
  agentId,
  urgency,
  status,
  platform,
  sort,
}: {
  agents: { id: string; name: string }[]
  agentId: string
  urgency: string
  status: string
  platform: string
  sort: SortOption
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [isRefreshing, startRefresh] = useTransition()

  const navigate = (next: { agent?: string; urgency?: string; status?: string; platform?: string; sort?: SortOption }) => {
    const merged = {
      agent: next.agent ?? agentId,
      urgency: next.urgency ?? urgency,
      status: next.status ?? status,
      platform: next.platform ?? platform,
      sort: next.sort ?? sort,
    }
    const search = new URLSearchParams()
    if (merged.agent) search.set("agent", merged.agent)
    if (merged.urgency) search.set("urgency", merged.urgency)
    if (merged.status) search.set("status", merged.status)
    if (merged.platform) search.set("platform", merged.platform)
    if (merged.sort !== "relevance") search.set("sort", merged.sort)
    const qs = search.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const hasActiveFilters = !!(agentId || urgency || status || platform || sort !== "relevance")

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/50 p-2">
      <ListFilter className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />

      <Select value={agentId} onValueChange={(v) => navigate({ agent: v ?? "" })}>
        <SelectTrigger className="min-w-[9rem]">
          <SelectValue>
            {(v: string) => agents.find((a) => a.id === v)?.name ?? "All Agents"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All Agents</SelectItem>
          {agents.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={urgency} onValueChange={(v) => navigate({ urgency: v ?? "" })}>
        <SelectTrigger className="min-w-[8rem]">
          <SelectValue>
            {(v: string) => URGENCY_OPTIONS.find((o) => o.value === v)?.label ?? "All Urgency"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {URGENCY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={status} onValueChange={(v) => navigate({ status: v ?? "" })}>
        <SelectTrigger className="min-w-[8rem]">
          <SelectValue>
            {(v: string) => STATUS_OPTIONS.find((o) => o.value === v)?.label ?? "All Status"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={platform} onValueChange={(v) => navigate({ platform: v ?? "" })}>
        <SelectTrigger className="min-w-[9rem]">
          <SelectValue>
            {(v: string) => PLATFORM_OPTIONS.find((o) => o.value === v)?.label ?? "All Platforms"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PLATFORM_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="mx-1 h-5 w-px bg-border" />

      <ArrowDownWideNarrow className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Select value={sort} onValueChange={(v) => navigate({ sort: v as SortOption })}>
        <SelectTrigger className="min-w-[11rem]">
          <SelectValue>
            {(v: SortOption) => SORT_OPTIONS.find((o) => o.value === v)?.label ?? "Best Match"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={() => navigate({ agent: "", urgency: "", status: "", platform: "", sort: "relevance" })}>
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        disabled={isRefreshing}
        onClick={() => startRefresh(() => router.refresh())}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </div>
  )
}
