"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Pause, Play } from "lucide-react"

export function GroupActiveToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleToggle = () => {
    startTransition(async () => {
      const res = await fetch("/api/groups", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active: !active }),
      })
      if (res.ok) {
        router.refresh()
        return
      }

      // The server's own words, not a generic failure. The likeliest reason a
      // toggle is refused is the monitored-source limit, and that message
      // tells the customer exactly what to do about it — replacing it with
      // "failed to update group" turns a solvable situation into a bug report.
      const message = await res
        .json()
        .then((d: { error?: string }) => d.error)
        .catch(() => null)
      alert(message || "Couldn't update that source — try again.")
    })
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleToggle}
            disabled={isPending}
            aria-label={active ? "Pause monitoring" : "Resume monitoring"}
          >
            {active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
        }
      />
      <TooltipContent>
        {active ? "Pause monitoring — keeps the source, stops checking it" : "Resume monitoring"}
      </TooltipContent>
    </Tooltip>
  )
}
