"use client"

import { useRouter } from "next/navigation"
import { Activity, ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"

const urgencyLabel: Record<string, string> = {
  asap: "ASAP",
  high: "High Intent",
  medium: "Medium Intent",
  low: "Low Intent",
}

const urgencyVariant: Record<string, "destructive" | "warning" | "brand" | "secondary"> = {
  asap: "destructive",
  high: "warning",
  medium: "brand",
  low: "secondary",
}

function formatAlertTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

interface Lead {
  id: string
  author_name: string
  ai_summary: string | null
  content: string
  urgency: string
  location_mentioned: string | null
  platform: string | null
  post_url: string | null
  created_at: string
}

export function AlertRow({ lead }: { lead: Lead }) {
  const router = useRouter()

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/opportunities?id=${lead.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(`/opportunities?id=${lead.id}`)
      }}
      className="flex cursor-pointer items-center gap-4 rounded-lg p-2 -mx-2 transition-colors hover:bg-muted/50"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 ring-1 ring-blue-500/15 dark:text-blue-400">
        <Activity className="h-4 w-4" />
      </div>
      <div className="flex-1 space-y-1">
        <p className="text-sm font-medium leading-none">
          {lead.author_name}
          {lead.location_mentioned ? ` · ${lead.location_mentioned}` : ""}
        </p>
        <p className="text-sm text-muted-foreground">&quot;{lead.ai_summary || lead.content}&quot;</p>
        <div className="flex items-center gap-2 pt-0.5 text-xs text-muted-foreground">
          <span>{formatAlertTime(lead.created_at)}</span>
          {lead.post_url && (
            <>
              <span>·</span>
              <a
                href={lead.post_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-0.5 capitalize underline decoration-dotted underline-offset-2 hover:text-brand"
              >
                {lead.platform || "View"} post
                <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
        </div>
      </div>
      <Badge variant={urgencyVariant[lead.urgency] ?? "secondary"} className="shrink-0">
        {urgencyLabel[lead.urgency] ?? lead.urgency}
      </Badge>
    </div>
  )
}
