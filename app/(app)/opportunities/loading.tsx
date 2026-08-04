import { Skeleton } from "@/components/ui/skeleton"
import { PageHeaderSkeleton } from "@/components/ui/page-skeleton"

/**
 * Route-specific because the shared (app) skeleton is dashboard-shaped —
 * stat tiles then two panels — which is nothing like this page's filter bar
 * plus card grid. A mismatched placeholder makes content visibly jump when it
 * lands, which feels worse than a plain spinner.
 */
export default function OpportunitiesLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />

      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/50 p-2">
        <Skeleton className="h-8 w-44 rounded-lg" />
        <Skeleton className="h-8 w-36 rounded-lg" />
        <Skeleton className="h-8 w-32 rounded-lg" />
        <Skeleton className="h-8 w-32 rounded-lg" />
        <Skeleton className="h-8 w-36 rounded-lg" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <div className="flex gap-2 border-y border-border py-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 flex-1 rounded-lg" />
              <Skeleton className="h-8 w-20 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
