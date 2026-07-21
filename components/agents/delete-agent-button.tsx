"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Trash2 } from "lucide-react"

export function DeleteAgentButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  const handleDelete = () => {
    startTransition(async () => {
      const res = await fetch("/api/agents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        alert("Failed to delete agent")
      }
      setConfirming(false)
    })
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <Button variant="destructive" size="xs" onClick={handleDelete} disabled={isPending}>
          {isPending ? "Deleting…" : `Delete ${name}?`}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setConfirming(false)} disabled={isPending}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" onClick={() => setConfirming(true)} aria-label={`Delete ${name}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <TooltipContent>Delete agent</TooltipContent>
    </Tooltip>
  )
}
