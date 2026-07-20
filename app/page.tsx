import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Activity, Target, MessageSquare, ListChecks, MapPin } from "lucide-react"
import db from "@/lib/db"
import { db as opportunityDb } from "@/lib/db/schema"

export const dynamic = "force-dynamic"

interface LeadRow {
  id: number
  author_name: string
  service_summary: string
  urgency: string
  location_mentioned: string | null
  created_at: string
}

interface GroupRow {
  id: number
  platform: string
  name: string
  post_count: number
}

const urgencyLabel: Record<string, string> = {
  asap: "ASAP",
  high: "High Intent",
  medium: "Medium Intent",
  low: "Low Intent",
}

export default function Home() {
  const highIntentCount = (
    db.prepare(`SELECT COUNT(*) as c FROM leads WHERE urgency IN ('asap', 'high')`).get() as { c: number }
  ).c
  const activeConversations = (
    db.prepare(`SELECT COUNT(*) as c FROM leads WHERE status = 'approved'`).get() as { c: number }
  ).c
  const pendingReview = (
    db.prepare(`SELECT COUNT(*) as c FROM leads WHERE status = 'pending'`).get() as { c: number }
  ).c
  const communitiesMonitored = (
    db.prepare(`SELECT COUNT(*) as c FROM groups WHERE active = 1`).get() as { c: number }
  ).c

  const recentLeads = db
    .prepare(
      `SELECT id, author_name, service_summary, urgency, location_mentioned, created_at
       FROM leads ORDER BY created_at DESC LIMIT 4`
    )
    .all() as LeadRow[]

  const monitoredGroups = db
    .prepare(
      `SELECT groups.id, groups.platform, groups.name, COUNT(posts.id) as post_count
       FROM groups
       LEFT JOIN posts ON posts.group_id = groups.id
       WHERE groups.active = 1
       GROUP BY groups.id
       ORDER BY groups.created_at DESC
       LIMIT 4`
    )
    .all() as GroupRow[]

  const leadLocations = db
    .prepare(
      `SELECT location_mentioned FROM leads WHERE location_mentioned IS NOT NULL AND TRIM(location_mentioned) != ''`
    )
    .all() as { location_mentioned: string }[]
  const opportunityLocations = opportunityDb
    .prepare(
      `SELECT location_mentioned FROM opportunities WHERE location_mentioned IS NOT NULL AND TRIM(location_mentioned) != ''`
    )
    .all() as { location_mentioned: string }[]

  const locationCounts = new Map<string, number>()
  for (const row of [...leadLocations, ...opportunityLocations]) {
    const key = row.location_mentioned.trim()
    locationCounts.set(key, (locationCounts.get(key) || 0) + 1)
  }
  const heatMap = Array.from(locationCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  const maxHeat = heatMap.length > 0 ? heatMap[0][1] : 1

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Today's Opportunities</h2>
        <p className="text-muted-foreground">Here is your daily AI digest.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="overflow-hidden">
          <CardContent className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-muted-foreground">High Intent Leads</span>
              <span className="text-3xl font-bold tracking-tight">{highIntentCount}</span>
              <span className="text-xs text-muted-foreground">ASAP or high-urgency leads</span>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <Target className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-muted-foreground">Active Conversations</span>
              <span className="text-3xl font-bold tracking-tight">{activeConversations}</span>
              <span className="text-xs text-muted-foreground">Approved & dispatched to GHL</span>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <MessageSquare className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-muted-foreground">Pending Review</span>
              <span className="text-3xl font-bold tracking-tight">{pendingReview}</span>
              <span className="text-xs text-muted-foreground">Leads awaiting your decision</span>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <ListChecks className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardContent className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-muted-foreground">Communities Monitored</span>
              <span className="text-3xl font-bold tracking-tight">{communitiesMonitored}</span>
              <span className="text-xs text-muted-foreground">Active groups being scraped</span>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Activity className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Recent Alerts</CardTitle>
            <CardDescription>Latest leads found by your scraping engine.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentLeads.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <Activity className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No leads yet — run a scrape to populate this feed.</p>
                </div>
              )}
              {recentLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center gap-4 rounded-lg p-2 -mx-2 transition-colors hover:bg-muted/50"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <Activity className="h-4 w-4" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {lead.author_name}
                      {lead.location_mentioned ? ` · ${lead.location_mentioned}` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">&quot;{lead.service_summary}&quot;</p>
                  </div>
                  <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                    {urgencyLabel[lead.urgency] ?? lead.urgency}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Communities You&apos;re Monitoring</CardTitle>
            <CardDescription>Groups actively being scraped for opportunities.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {monitoredGroups.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <Activity className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No groups added yet.</p>
                </div>
              )}
              {monitoredGroups.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center gap-4 rounded-lg p-2 -mx-2 transition-colors hover:bg-muted/50"
                >
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium leading-none">{g.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {g.platform} • {g.post_count} posts collected
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Opportunity Heat Map</CardTitle>
          <CardDescription>Where demand is concentrated, across all leads and opportunities.</CardDescription>
        </CardHeader>
        <CardContent>
          {heatMap.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No locations extracted yet — they show up here as leads and opportunities mention them.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {heatMap.map(([location, count]) => (
                <div key={location} className="flex items-center gap-3">
                  <div className="flex w-32 shrink-0 items-center gap-1.5 text-sm">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">{location}</span>
                  </div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{ width: `${Math.max((count / maxHeat) * 100, 4)}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right text-sm font-medium">{count}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
