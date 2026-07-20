import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Activity, Target, MessageSquare, ListChecks } from "lucide-react"
import db from "@/lib/db"

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Today's Opportunities</h2>
        <p className="text-muted-foreground">Here is your daily AI digest.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High Intent Leads</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{highIntentCount}</div>
            <p className="text-xs text-muted-foreground">ASAP or high-urgency leads</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Conversations</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeConversations}</div>
            <p className="text-xs text-muted-foreground">Approved & dispatched to GHL</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
            <ListChecks className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingReview}</div>
            <p className="text-xs text-muted-foreground">Leads awaiting your decision</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Communities Monitored</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{communitiesMonitored}</div>
            <p className="text-xs text-muted-foreground">Active groups being scraped</p>
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
                <p className="text-sm text-muted-foreground">No leads yet — run a scrape to populate this feed.</p>
              )}
              {recentLeads.map((lead) => (
                <div key={lead.id} className="flex items-center gap-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
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
                <p className="text-sm text-muted-foreground">No groups added yet.</p>
              )}
              {monitoredGroups.map((g) => (
                <div key={g.id} className="flex items-center gap-4">
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
    </div>
  )
}
