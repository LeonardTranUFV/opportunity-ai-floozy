"use client"

import { Play, RotateCw } from "lucide-react"
import { useTour } from "@/components/tour/tour-provider"

export function StartTourButton() {
  const { start, hasCompleted } = useTour()

  return (
    <button
      type="button"
      onClick={start}
      className="flex h-9 w-fit items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
    >
      {hasCompleted ? <RotateCw className="size-3.5" /> : <Play className="size-3.5" />}
      {hasCompleted ? "Replay the walkthrough" : "Show me around"}
    </button>
  )
}
