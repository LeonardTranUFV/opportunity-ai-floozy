import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Compass, Search, Link2 } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { DiscoverGroupsForm } from "@/components/communities/discover-groups-form"
import { AddSourceForm } from "@/components/communities/add-source-form"
import { GroupActiveToggle } from "@/components/communities/group-active-toggle"
import { GroupName } from "@/components/communities/group-name"
import { DeleteGroupButton } from "@/components/communities/delete-group-button"
import { ScrapeNowButton } from "@/components/communities/scrape-now-button"
import { FacebookIcon, LinkedInIcon, NextdoorIcon, XIcon, RedditIcon } from "@/components/icons"

const PLATFORM_META: Record<string, { label: string; Icon: typeof FacebookIcon; iconColor: string }> = {
  facebook: { label: "Facebook", Icon: FacebookIcon, iconColor: "bg-[#1877F2]/10 text-[#1877F2]" },
  linkedin: { label: "LinkedIn", Icon: LinkedInIcon, iconColor: "bg-[#0A66C2]/10 text-[#0A66C2]" },
  nextdoor: { label: "Nextdoor", Icon: NextdoorIcon, iconColor: "bg-[#8fca43]/10 text-[#8fca43]" },
  twitter: { label: "X", Icon: XIcon, iconColor: "bg-foreground/10 text-foreground" },
  reddit: { label: "Reddit", Icon: RedditIcon, iconColor: "bg-orange-600/10 text-orange-600" },
}
const PLATFORM_ORDER = ["facebook", "linkedin", "nextdoor", "twitter", "reddit"]

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

  const groupsByPlatform = new Map<string, typeof groups>()
  for (const g of groups) {
    const list = groupsByPlatform.get(g.platform) ?? []
    list.push(g)
    groupsByPlatform.set(g.platform, list)
  }
  const platformSections = [
    ...PLATFORM_ORDER.filter((p) => groupsByPlatform.has(p)),
    ...[...groupsByPlatform.keys()].filter((p) => !PLATFORM_ORDER.includes(p)),
  ]

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
            Add a Source
          </CardTitle>
          <CardDescription>Pick a platform, then add what you want to monitor there.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddSourceForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Monitored Sources</CardTitle>
          <CardDescription>
            {groups.length} sources being tracked. Scanning an agent now scrapes these automatically first —
            you only need this button if you want to pull fresh posts without running a scan.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ScrapeNowButton />
          {groups.length === 0 ? (
            <EmptyState
              icon={Compass}
              title="No sources yet"
              description="Discover some above, or they'll be added automatically as agents scan."
            />
          ) : (
            <div className="flex flex-col gap-5">
              {platformSections.map((platform) => {
                const meta = PLATFORM_META[platform]
                const platformGroups = groupsByPlatform.get(platform)!
                return (
                  <div key={platform} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      {meta ? (
                        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${meta.iconColor}`}>
                          <meta.Icon className="h-3.5 w-3.5" />
                        </div>
                      ) : null}
                      <span className="text-sm font-semibold capitalize">{meta?.label ?? platform}</span>
                      <span className="text-xs text-muted-foreground">
                        {platformGroups.length} source{platformGroups.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {platformGroups.map((g) => (
                      <div
                        key={g.id}
                        className="flex items-center justify-between gap-4 rounded-lg border border-border p-3 transition-colors hover:border-brand/30 hover:bg-brand/[0.03]"
                      >
                        <div className="flex min-w-0 flex-col gap-1">
                          <GroupName id={g.id} name={g.name} url={g.url} />
                          <div className="flex items-center gap-1.5">
                            <Badge variant={g.active ? "success" : "secondary"}>
                              {g.active ? "Active" : "Paused"}
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
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
