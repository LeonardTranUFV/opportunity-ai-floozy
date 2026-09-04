"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Trash2 } from "lucide-react"
import { readApiError } from "@/lib/format-error"

export function DeleteGroupButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleDelete = () => {
    if (!confirm(`Stop monitoring "${name}"?`)) return
    startTransition(async () => {
      const res = await fetch("/api/groups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        alert(await readApiError(res, "Couldn't remove that source"))
      }
    })
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" onClick={handleDelete} disabled={isPending} aria-label={`Remove ${name}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <TooltipContent>Stop monitoring</TooltipContent>
    </Tooltip>
  )
}
