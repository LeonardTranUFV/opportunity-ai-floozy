"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function ApproveRejectButtons({ id }: { id: number }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  const handleUpdate = (status: "qualified" | "lost") => {
    setMessage(null)
    startTransition(async () => {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setMessage(data.error || "Update failed")
        return
      }
      if (status === "qualified") {
        if (data.ghl?.success) {
          setMessage("Approved and dispatched to GHL.")
        } else if (data.ghl) {
          setMessage(`Approved, but GHL dispatch was skipped: ${data.ghl.reason}`)
        } else {
          setMessage("Approved.")
        }
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => handleUpdate("qualified")} disabled={isPending}>
          {isPending ? "Working…" : "Approve & Dispatch to GHL"}
        </Button>
        <Button variant="destructive" onClick={() => handleUpdate("lost")} disabled={isPending}>
          Reject
        </Button>
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  )
}
