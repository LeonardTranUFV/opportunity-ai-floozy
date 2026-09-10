import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Compass, Search, Link2 } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { FindGroups } from "@/components/communities/find-groups"
import { AddSourceForm } from "@/components/communities/add-source-form"
import { CheckSourcesButton } from "@/components/communities/check-sources-button"
import { ResyncGroupsButton } from "@/components/communities/resync-groups-button"
import { isHostedDeployment } from "@/lib/deployment"
import { canRunSignedInBrowser } from "@/lib/remote-browser"
import { getSourceCapacity, partitionByCap } from "@/lib/entitlement"
import { SourceList } from "@/components/communities/source-list"

export const dynamic = "force-dynamic"

export default async function CommunitiesPage() {
  const hosted = isHostedDeployment()
  // Two different questions, and this page was answering both with the first.
  //
  // `hosted` decides whether to offer the re-import of Facebook groups — that
  // one really is about being on the hosted site, because locally the crawler
  // reads a Chrome profile and there is nothing to re-import.
  //
  // `noBrowser` decides whether the Facebook features work at all, and that
  // is now a separate fact: hosted with a cloud browser configured can run
  // them, hosted without one cannot.
  const noBrowser = !canRunSignedInBrowser()
  const supabase = await createClient()

  const { data: allGroups } = await supabase
    .from("groups")
    .select("id, platform, name, url, active, needs_membership, created_at")
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

  // What the plan allows, and what is being used. Shown rather than only
  // enforced: a limit a customer discovers by being refused is a worse
  // experience than the same limit they could see coming.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const capacity = user
    ? await getSourceCapacity(supabase, user.id)
    : { plan: "trial", used: 0, limit: 0, remaining: 0, unlimited: false }

  // The same split the collector makes, so a source flagged here is exactly
  // one that is not being read. An account can be over its cap without ever
  // being refused — sources added before the limit existed, or by an admin.
  const overCapIds = new Set(
    partitionByCap(
      groups.filter((g) => g.active),
      capacity
    ).overCap.map((g) => g.id)
  )
  const overCapCount = overCapIds.size

  // Reddit needs no browser and no login, so it is the one source type that
  // collects even where a signed-in browser cannot be opened at all.
  const hasFetchableSource = groups.some((g) => g.platform === "reddit" && g.active)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Sources</h2>
        <p className="text-muted-foreground">
          The groups, feeds and searches we read for you. Add the ones where people near you
          ask for your trade.
        </p>
      </div>

      <Card className="transition-shadow hover:shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-4 w-4 text-brand" />
            Find groups to monitor
          </CardTitle>
          <CardDescription>
            Search Facebook for groups in your trade and area, then track the ones worth watching.
            If you&apos;re not sure what to search for, the AI can suggest phrases. Public groups
            start collecting posts without joining — but you have to be a member to comment, so join
            the ones you actually want to reply in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FindGroups noBrowser={noBrowser} />
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
        <CardContent className="flex flex-col gap-5">
          <AddSourceForm />

          {/* Hosted only. There, a connected account means a stored session a
              cloud browser can reuse. Locally the crawler already reads a
              Chrome profile on disk, so there is nothing to re-import. */}
          {hosted ? (
            <div className="flex flex-col gap-2 border-t border-border pt-5">
              <p className="text-sm font-medium">Already in groups on Facebook?</p>
              <p className="text-sm text-muted-foreground">
                We read your groups once when you connected, and Facebook only loads part of
                that list at a time. Run this to pick up the rest, or anything you&apos;ve joined
                since — no need to log in again.
              </p>
              <ResyncGroupsButton />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Your sources</CardTitle>
              <CardDescription>
                {groups.length} sources added. Finding opportunities checks these automatically
                first — you only need this button if you want fresh posts without running a full
                scan.
              </CardDescription>
            </div>

            {/* The number that actually constrains them, kept next to the list
                it constrains. Reddit is excluded because it needs no browser
                and so costs nothing to watch — saying so here stops the count
                looking wrong to anyone who has added one. */}
            <div className="flex w-full shrink-0 flex-col gap-1.5 sm:w-52">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Actively monitored</span>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    !capacity.unlimited && capacity.remaining === 0 ? "text-amber-600 dark:text-amber-400" : ""
                  }`}
                >
                  {capacity.unlimited ? `${capacity.used} · no limit` : `${capacity.used} / ${capacity.limit}`}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${
                    !capacity.unlimited && capacity.remaining === 0 ? "bg-amber-500" : "bg-brand"
                  }`}
                  style={{
                    width: capacity.unlimited
                      ? "100%"
                      : `${capacity.limit ? Math.min(100, (capacity.used / capacity.limit) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {capacity.unlimited
                  ? "This account has no source limit (admin / pool access) — every active source is read."
                  : overCapCount > 0
                    ? `Over your limit — ${overCapCount} of these ${overCapCount === 1 ? "isn't" : "aren't"} being read. Pause ${overCapCount} to bring the rest back, or upgrade.`
                    : capacity.remaining === 0
                      ? "At your limit — pause one to switch another on."
                      : `${capacity.remaining} more can be switched on.`}{" "}
                Reddit sources don&apos;t count.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Only disabled when there is genuinely nothing this deployment
              could collect: no cloud browser configured *and* no Reddit source,
              which is read over plain HTTP and works everywhere. With a cloud
              browser the Facebook sources collect here too, so the button
              stays live. */}
          <CheckSourcesButton
            disabledReason={
              noBrowser && !hasFetchableSource
                ? "None of your sources can be collected here: they all need a signed-in browser, and no cloud browser is configured. Add a Reddit source and this will start collecting."
                : undefined
            }
          />
          {groups.length === 0 ? (
            <EmptyState
              icon={Compass}
              title="No sources yet"
              description="Discover some above, or they'll be added automatically as agents scan."
            />
          ) : (
            <SourceList
              groups={groups.map((g) => ({ ...g, active: !!g.active }))}
              overCapIds={[...overCapIds]}
              capacityLimit={capacity.limit}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
