"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"

interface Notification {
  id: number
  author_name: string
  ai_summary: string | null
  content: string
  urgency: string
  intent_score: number | null
  agent_name: string
}

const POLL_INTERVAL_MS = 60_000

export function NotificationsBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch("/api/notifications")
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data.success) {
          setNotifications(data.notifications)
        }
      } catch {
        // silently ignore — notifications are non-critical
      }
    }

    load()
    const interval = setInterval(load, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Notifications">
        <span className="relative">
          <Bell className="h-4 w-4" />
          {notifications.length > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {notifications.length > 9 ? "9+" : notifications.length}
            </span>
          )}
        </span>
      </Button>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>High-Intent Opportunities</SheetTitle>
          <SheetDescription>New opportunities your AI agents flagged as urgent.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing urgent right now.</p>
          ) : (
            notifications.map((n) => (
              <Link
                key={n.id}
                href="/opportunities"
                onClick={() => setOpen(false)}
                className="flex flex-col gap-1 rounded-lg border p-3 text-sm hover:bg-muted/50"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{n.author_name}</span>
                  <span className="text-xs uppercase text-muted-foreground">{n.urgency}</span>
                </div>
                <p className="text-muted-foreground">{n.ai_summary || n.content}</p>
                <span className="text-xs text-muted-foreground">via {n.agent_name}</span>
              </Link>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
