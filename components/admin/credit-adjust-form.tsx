"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export function CreditAdjustForm({ userId }: { userId: string }) {
  const router = useRouter()
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  const submit = () => {
    const parsed = Number(amount)
    if (!Number.isFinite(parsed) || parsed === 0) {
      setMessage("Enter a non-zero number (negative to deduct).")
      return
    }
    setMessage(null)
    startTransition(async () => {
      const res = await fetch("/api/admin/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amount: parsed, note }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setMessage(data.error || "Failed to adjust credits")
        return
      }
      setMessage(`Done — new balance: ${data.balance}`)
      setAmount("")
      setNote("")
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="+50 or -10"
        className="w-28"
      />
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Reason (e.g. bug refund)"
        className="w-48"
      />
      <Button size="sm" variant="outline" onClick={submit} disabled={isPending}>
        {isPending ? "Applying…" : "Apply"}
      </Button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  )
}
