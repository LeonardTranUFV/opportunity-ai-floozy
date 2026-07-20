import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import leadsDb from "@/lib/db"
import { DiscoverGroupsForm } from "@/components/communities/discover-groups-form"
import { GroupActiveToggle } from "@/components/communities/group-active-toggle"
import { DeleteGroupButton } from "@/components/communities/delete-group-button"

export const dynamic = "force-dynamic"

interface GroupRow {
  id: number
  platform: string
  name: string
  url: string
  active: number
  post_count: number
}

export default function CommunitiesPage() {
  const groups = leadsDb
    .prepare(
      `SELECT groups.id, groups.platform, groups.name, groups.url, groups.active, COUNT(posts.id) as post_count
       FROM groups
       LEFT JOIN posts ON posts.group_id = groups.id
       GROUP BY groups.id
       ORDER BY groups.created_at DESC`
    )
    .all() as GroupRow[]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Community Discovery</h2>
        <p className="text-muted-foreground">
          Find and monitor the communities most likely to contain your opportunities.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Discover Facebook Groups</CardTitle>
          <CardDescription>
            Searches Facebook live using your saved session — this can take up to 20 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DiscoverGroupsForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monitored Communities</CardTitle>
          <CardDescription>{groups.length} groups being tracked.</CardDescription>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No groups yet — discover some above, or they&apos;ll be added automatically as agents scan.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {groups.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="flex flex-col gap-0.5">
                    <a href={g.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">
                      {g.name}
                    </a>
                    <span className="text-xs text-muted-foreground capitalize">
                      {g.platform} · {g.post_count} posts collected
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
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
