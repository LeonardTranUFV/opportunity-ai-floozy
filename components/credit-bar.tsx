"use client"

import Link from "next/link"
import { Gem } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function CreditBar({ balance, allowance }: { balance: number; allowance: number }) {
  const pct = allowance > 0 ? Math.max(0, Math.min(100, (balance / allowance) * 100)) : 0

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href="/pricing"
            aria-label={`${balance} of ${allowance} credits remaining — click to buy more`}
            className="flex items-center gap-1.5 rounded-full border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-muted"
          />
        }
      >
        <Gem className="h-3.5 w-3.5 shrink-0 text-brand" />
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-600 transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {balance} / {allowance} credits — click to buy more
      </TooltipContent>
    </Tooltip>
  )
}
