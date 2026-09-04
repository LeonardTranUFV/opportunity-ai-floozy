"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Trash2 } from "lucide-react"
import { readApiError } from "@/lib/format-error"

export function DeleteOpportunityButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleDelete = () => {
    if (!confirm(`Permanently remove the opportunity from "${name}"? This can't be undone.`)) return
    startTransition(async () => {
      const res = await fetch(`/api/opportunities/${id}`, { method: "DELETE" })
      if (res.ok) {
        router.refresh()
      } else {
        alert(await readApiError(res, "Couldn't remove that lead"))
      }
    })
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDelete}
            disabled={isPending}
            aria-label={`Remove opportunity from ${name}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <TooltipContent>Remove opportunity</TooltipContent>
    </Tooltip>
  )
}
