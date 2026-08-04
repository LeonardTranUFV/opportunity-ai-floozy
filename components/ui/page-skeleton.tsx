import { Skeleton } from "@/components/ui/skeleton"

/**
 * Shared placeholders for route-level loading.tsx files.
 *
 * These pages are `force-dynamic` and take ~1-2s server-side, during which the
 * user previously saw nothing at all — which reads as a broken app rather than
 * a loading one. The shapes deliberately mirror the real layout so content
 * doesn't jump when it arrives.
 */
export function PageHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  )
}

export function CardSkeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 ${className}`}>
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: `${88 - i * 14}%` }} />
      ))}
    </div>
  )
}

export function StatRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start justify-between rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="size-10 rounded-xl" />
        </div>
      ))}
    </div>
  )
}

export function ListRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-7 w-16 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  )
}
