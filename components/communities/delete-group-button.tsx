"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"

export function DeleteGroupButton({ id, name }: { id: number; name: string }) {
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
        alert("Failed to remove group")
      }
    })
  }

  return (
    <Button variant="ghost" size="icon-sm" onClick={handleDelete} disabled={isPending} aria-label={`Remove ${name}`}>
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  )
}
