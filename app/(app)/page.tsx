import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Activity, Target, MessageSquare, ListChecks, MapPin, Compass, Flame, MessageCircle, Send } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { RecentAlertsList } from "@/components/dashboard/recent-alerts-list"

export const dynamic = "force-dynamic"

export default async function Home() {
  const supabase = await createClient()

  const [
    { count: highIntentCount },
    { count: activeConversations },
    { count: pendingReview },
    { count: communitiesMonitored },
    { count: commentsSent },
    { count: dmsSent },
    { data: recentOpportunities },
    { data: allGroups },
    { data: locationsData },
  ] = await Promise.all([
    supabase.from("opportunities").select("*", { count: "exact", head: true }).in("urgency", ["asap", "high"]),
    supabase.from("opportunities").select("*", { count: "exact", head: true }).eq("status", "qualified"),
    supabase.from("opportunities").select("*", { count: "exact", head: true }).eq("status", "new"),
    supabase.from("groups").select("*", { count: "exact", head: true }).eq("active", true),
    supabase.from("opportunities").select("*", { count: "exact", head: true }).not("comment_sent_at", "is", null),
    supabase.from("opportunities").select("*", { count: "exact", head: true }).not("dm_sent_at", "is", null),
    supabase
      .from("opportunities")
      .select("id, author_name, ai_summary, content, urgency, location_mentioned, platform, post_url, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("groups").select("id, platform, name, active").eq("active", true).order("created_at", { ascending: false }).limit(4),
    supabase.from("opportunities").select("location_mentioned").not("location_mentioned", "is", null),
  ])

  // post counts per monitored group (small dataset, fine to do client-side)
  const groupIds = (allGroups ?? []).map((g) => g.id)
  const { data: postsForGroups } = groupIds.length
    ? await supabase.from("posts").select("group_id").in("group_id", groupIds)
    : { data: [] as { group_id: string }[] }
  const postCountByGroup = new Map<string, number>()
  for (const p of postsForGroups ?? []) {
    postCountByGroup.set(p.group_id, (postCountByGroup.get(p.group_id) ?? 0) + 1)
  }
  const monitoredGroups = (allGroups ?? []).map((g) => ({ ...g, post_count: postCountByGroup.get(g.id) ?? 0 }))

  const locationCounts = new Map<string, number>()
  for (const row of locationsData ?? []) {
    const key = row.location_mentioned?.trim()
    if (!key) continue
    locationCounts.set(key, (locationCounts.get(key) || 0) + 1)
  }
  const heatMap = Array.from(locationCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  const maxHeat = heatMap.length > 0 ? heatMap[0][1] : 1

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-bold tracking-tight">Today&apos;s Opportunities</h2>
        <p className="text-muted-foreground">Here is your daily AI digest.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link href="/opportunities?highIntent=1" className="block">
          <Card className="overflow-hidden transition-all hover:shadow-md hover:ring-1 hover:ring-brand/20">
            <CardContent className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-muted-foreground">High Intent Leads</span>
                <span className="text-3xl font-bold tracking-tight">{highIntentCount ?? 0}</span>
                <span className="text-xs text-muted-foreground">ASAP or high-urgency leads</span>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 ring-1 ring-rose-500/15 dark:text-rose-400">
                <Target className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/opportunities?status=qualified" className="block">
          <Card className="overflow-hidden transition-all hover:shadow-md hover:ring-1 hover:ring-brand/20">
            <CardContent className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-muted-foreground">Active Conversations</span>
                <span className="text-3xl font-bold tracking-tight">{activeConversations ?? 0}</span>
                <span className="text-xs text-muted-foreground">Approved leads</span>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 ring-1 ring-blue-500/15 dark:text-blue-400">
                <MessageSquare className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/opportunities?status=new" className="block">
          <Card className="overflow-hidden transition-all hover:shadow-md hover:ring-1 hover:ring-brand/20">
            <CardContent className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-muted-foreground">Pending Review</span>
                <span className="text-3xl font-bold tracking-tight">{pendingReview ?? 0}</span>
                <span className="text-xs text-muted-foreground">Leads awaiting your decision</span>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/15 dark:text-amber-400">
                <ListChecks className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/communities" className="block">
          <Card className="overflow-hidden transition-all hover:shadow-md hover:ring-1 hover:ring-brand/20">
            <CardContent className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-muted-foreground">Communities Monitored</span>
                <span className="text-3xl font-bold tracking-tight">{communitiesMonitored ?? 0}</span>
                <span className="text-xs text-muted-foreground">Active groups being scraped</span>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/15 dark:text-emerald-400">
                <Activity className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Recent Alerts</CardTitle>
            <CardDescription>Latest leads found by your scraping engine.</CardDescription>
          </CardHeader>
          <CardContent>
            {!recentOpportunities || recentOpportunities.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No leads yet"
                description="Run a scrape to populate this feed."
              />
            ) : (
              <RecentAlertsList leads={recentOpportunities} />
            )}
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Communities You&apos;re Monitoring</CardTitle>
            <CardDescription>Groups actively being scraped for opportunities.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {monitoredGroups.length === 0 && (
                <EmptyState icon={Compass} title="No groups added yet" />
              )}
              {monitoredGroups.map((g) => (
                <Link
                  key={g.id}
                  href="/communities"
                  className="flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-muted/50"
                >
                  <div className="flex-1 space-y-1 min-w-0">
                    <p className="truncate text-sm font-medium leading-none">{g.name}</p>
                    <p className="text-xs text-muted-foreground">{g.post_count} posts collected</p>
                  </div>
                  <Badge variant="outline" className="shrink-0 capitalize">
                    {g.platform}
                  </Badge>
                </Link>
              ))}
            </div>
            <Link
              href="/communities"
              className="mt-2 flex items-center text-sm text-brand underline decoration-dotted underline-offset-4 hover:text-brand/80"
            >
              View all communities →
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Outreach Sent</CardTitle>
          <CardDescription>Personalized comments and DMs sent directly from this app.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/15">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold tracking-tight">{commentsSent ?? 0}</span>
                <span className="text-xs text-muted-foreground">Comments posted</span>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/15">
                <Send className="h-5 w-5" />
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold tracking-tight">{dmsSent ?? 0}</span>
                <span className="text-xs text-muted-foreground">DMs sent</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-brand" />
            Opportunity Heat Map
          </CardTitle>
          <CardDescription>Where demand is concentrated, across all leads and opportunities.</CardDescription>
        </CardHeader>
        <CardContent>
          {heatMap.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No locations extracted yet — they show up here as leads and opportunities mention them.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {heatMap.map(([location, count]) => (
                <Link
                  key={location}
                  href={`/opportunities?location=${encodeURIComponent(location)}`}
                  className="flex items-center gap-3 rounded-lg p-1.5 -mx-1.5 transition-colors hover:bg-muted/50"
                >
                  <div className="flex w-32 shrink-0 items-center gap-1.5 text-sm">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">{location}</span>
                  </div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand/70 to-brand transition-all"
                      style={{ width: `${Math.max((count / maxHeat) * 100, 4)}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right text-sm font-medium tabular-nums">{count}</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
