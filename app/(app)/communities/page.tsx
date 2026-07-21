import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Compass, Search, Link2 } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { DiscoverGroupsForm } from "@/components/communities/discover-groups-form"
import { AddGroupUrlForm } from "@/components/communities/add-group-url-form"
import { GroupActiveToggle } from "@/components/communities/group-active-toggle"
import { DeleteGroupButton } from "@/components/communities/delete-group-button"
import { ScrapeNowButton } from "@/components/communities/scrape-now-button"

export const dynamic = "force-dynamic"

export default async function CommunitiesPage() {
  const supabase = await createClient()

  const { data: allGroups } = await supabase
    .from("groups")
    .select("id, platform, name, url, active")
    .order("created_at", { ascending: false })

  const groupIds = (allGroups ?? []).map((g) => g.id)
  const { data: postsForGroups } = groupIds.length
    ? await supabase.from("posts").select("group_id").in("group_id", groupIds)
    : { data: [] as { group_id: string }[] }

  const postCountByGroup = new Map<string, number>()
  for (const p of postsForGroups ?? []) {
    postCountByGroup.set(p.group_id, (postCountByGroup.get(p.group_id) ?? 0) + 1)
  }
  const groups = (allGroups ?? []).map((g) => ({ ...g, post_count: postCountByGroup.get(g.id) ?? 0 }))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Community Discovery</h2>
        <p className="text-muted-foreground">
          Find and monitor the communities most likely to contain your opportunities.
        </p>
      </div>

      <Card className="transition-shadow hover:shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-4 w-4 text-brand" />
            Discover Facebook Groups
          </CardTitle>
          <CardDescription>
            Searches Facebook live using your saved session — this can take up to 20 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DiscoverGroupsForm />
        </CardContent>
      </Card>

      <Card className="transition-shadow hover:shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-brand" />
            Add Group by Link
          </CardTitle>
          <CardDescription>Already know the group? Paste its URL to start tracking it directly.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddGroupUrlForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monitored Communities</CardTitle>
          <CardDescription>
            {groups.length} groups being tracked. Scraping pulls fresh posts from active groups only —
            run it, then head to Agents to scan for opportunities.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ScrapeNowButton />
          {groups.length === 0 ? (
            <EmptyState
              icon={Compass}
              title="No groups yet"
              description="Discover some above, or they'll be added automatically as agents scan."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border p-3 transition-colors hover:border-brand/30 hover:bg-brand/[0.03]"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <a
                      href={g.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm font-medium hover:text-brand hover:underline"
                    >
                      {g.name}
                    </a>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="capitalize">
                        {g.platform}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{g.post_count} posts collected</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <GroupActiveToggle id={g.id} active={!!g.active} />
                    <DeleteGroupButton id={g.id} name={g.name} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
