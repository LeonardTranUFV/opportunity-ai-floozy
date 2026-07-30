"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AlertRow } from "@/components/dashboard/alert-row"
import { cn } from "@/lib/utils"

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

const PREVIEW_COUNT = 4

export function RecentAlertsList({ leads }: { leads: Lead[] }) {
  const [expanded, setExpanded] = useState(false)
  const hasMore = leads.length > PREVIEW_COUNT
  const visible = expanded ? leads : leads.slice(0, PREVIEW_COUNT)

  return (
    <div className="flex flex-col gap-1">
      <div className={cn("flex flex-col gap-1", expanded && "max-h-[28rem] overflow-y-auto pr-1")}>
        {visible.map((lead) => (
          <AlertRow key={lead.id} lead={lead} />
        ))}
      </div>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-fit text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Show more ({leads.length - PREVIEW_COUNT} more)
            </>
          )}
        </Button>
      )}
    </div>
  )
}
