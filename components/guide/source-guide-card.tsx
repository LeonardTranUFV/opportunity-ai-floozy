"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export function SourceGuideCard({
  icon,
  iconColor,
  accentColor,
  tag,
  title,
  description,
  steps,
  caveat,
  useNowHref,
  useNowLabel = "Use now",
  comingSoon = false,
  defaultOpen = false,
}: {
  icon: React.ReactNode
  iconColor: string
  accentColor?: string
  tag: string
  title: string
  description: string
  steps: string[]
  caveat?: string
  useNowHref: string
  useNowLabel?: string
  comingSoon?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-t-2 border-border bg-card p-4 transition-shadow",
        accentColor,
        !comingSoon && "hover:shadow-sm"
      )}
    >
      <div className="flex items-center justify-between">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", iconColor)}>{icon}</div>
        <Badge variant={comingSoon ? "secondary" : "outline"}>{comingSoon ? "Coming soon" : tag}</Badge>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <ol className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 font-medium text-foreground">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
          {caveat && (
            <p className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
              {caveat}
            </p>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          Learn more
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </Button>
        {!comingSoon && (
          <Button size="sm" nativeButton={false} render={<Link href={useNowHref} />}>
            {useNowLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
