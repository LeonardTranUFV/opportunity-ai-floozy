import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"
import { MapPin, Phone, ExternalLink, Flame, Search, Clock } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { StatusSelect } from "@/components/opportunities/status-select"
import { GenerateReplyButton } from "@/components/opportunities/generate-reply-button"
import { ApproveRejectButtons } from "@/components/opportunities/approve-reject-buttons"
import { SendOutreachButtons } from "@/components/opportunities/send-outreach-buttons"
import { DeleteOpportunityButton } from "@/components/opportunities/delete-opportunity-button"
import { FilterBar, type SortOption } from "@/components/opportunities/filter-bar"

export const dynamic = "force-dynamic"

const URGENCY_VARIANT: Record<string, "destructive" | "warning" | "brand" | "secondary"> = {
  asap: "destructive",
  high: "warning",
  medium: "brand",
  low: "secondary",
}

const URGENCY_RANK: Record<string, number> = { asap: 0, high: 1, medium: 2, low: 3 }

function resolvePostTimestamp(
  posts: { posted_at: string | null; scraped_at: string | null } | null,
  createdAt: string
): number {
  const iso = posts?.posted_at || posts?.scraped_at || createdAt
  const ts = new Date(iso).getTime()
  return Number.isNaN(ts) ? 0 : ts
}

function sortOpportunities<T extends { urgency: string; intent_score: number | null; created_at: string; posts: unknown }>(
  list: T[],
  sort: SortOption
): T[] {
  if (sort === "newest" || sort === "oldest") {
    const withTs = list.map((opp) => ({
      opp,
      ts: resolvePostTimestamp(opp.posts as { posted_at: string | null; scraped_at: string | null } | null, opp.created_at),
    }))
    withTs.sort((a, b) => (sort === "newest" ? b.ts - a.ts : a.ts - b.ts))
    return withTs.map((x) => x.opp)
  }
  if (sort === "urgency") {
    return [...list].sort((a, b) => {
      const rankDiff = (URGENCY_RANK[a.urgency] ?? 4) - (URGENCY_RANK[b.urgency] ?? 4)
      return rankDiff !== 0 ? rankDiff : (b.intent_score ?? 0) - (a.intent_score ?? 0)
    })
  }
  return list
}

// Facebook's relative-age labels ("2h", "3d") get parsed into an ISO string
// at scrape time (posts.posted_at); when that parse fails the post has no
// posted_at, so scraped_at (always set) is the next-best signal of freshness.
function formatPostAge(postedAt: string | null, scrapedAt: string | null): { label: string; exact: string } | null {
  const iso = postedAt || scrapedAt;
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let label: string;
  if (minutes < 1) label = "just now";
  else if (minutes < 60) label = `${minutes}m ago`;
  else if (hours < 24) label = `${hours}h ago`;
  else if (days < 7) label = `${days}d ago`;
  else label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const exact = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return { label: (postedAt ? "" : "~") + label, exact };
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; urgency?: string; status?: string; sort?: string; id?: string }>
}) {
  const params = await searchParams
  const sort: SortOption = params.sort === "newest" || params.sort === "oldest" || params.sort === "urgency"
    ? params.sort
    : "relevance"
  const supabase = await createClient()

  const { data: agents } = await supabase.from("agents").select("id, name").order("name")

  let query = supabase
    .from("opportunities")
    .select("*, agents(name), posts:source_post_id(posted_at, scraped_at)")
    .order("intent_score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100)

  // A deep link from the dashboard's Recent Alerts — show just that one
  // opportunity regardless of status/agent/urgency, since the point is to
  // act on a specific lead someone clicked, not to browse a filtered list.
  if (params.id) {
    query = supabase
      .from("opportunities")
      .select("*, agents(name), posts:source_post_id(posted_at, scraped_at)")
      .eq("id", params.id)
  } else {
    if (params.agent) query = query.eq("agent_id", params.agent)
    if (params.urgency) query = query.eq("urgency", params.urgency)
    if (params.status) {
      query = query.eq("status", params.status)
    } else {
      // Default view hides rejected opportunities so "Reject" reads as removal —
      // they're still visible via Status → Lost here, and always in the CRM's Lost column.
      query = query.neq("status", "lost")
    }
  }

  const { data: rawOpportunities } = await query
  const opportunities = rawOpportunities ? sortOpportunities(rawOpportunities, sort) : rawOpportunities

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Opportunities</h2>
        <p className="text-muted-foreground">
          Everything your AI agents have found, ranked by intent score.
        </p>
      </div>

      {params.id ? (
        <a
          href="/opportunities"
          className="flex w-fit items-center gap-1.5 text-sm text-brand underline decoration-dotted underline-offset-4 hover:text-brand/80"
        >
          ← Back to all Opportunities
        </a>
      ) : (
        <FilterBar
          agents={agents ?? []}
          agentId={params.agent || ""}
          urgency={params.urgency || ""}
          status={params.status || ""}
          sort={sort}
        />
      )}

      {!opportunities || opportunities.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <EmptyState
              icon={Search}
              title="No opportunities match these filters yet"
              description="Go to AI Agents and run a scan to find new ones."
              action={
                <a
                  href="/agents"
                  className="text-sm font-medium text-brand underline decoration-dotted underline-offset-4 hover:text-brand/80"
                >
                  Go to AI Agents →
                </a>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {opportunities.map((opp) => {
            const isHot = (opp.intent_score ?? 0) >= 90 || opp.urgency === "asap"
            const confidence = Math.max(0, Math.min(100, opp.intent_score ?? 0))
            const agentName = (opp.agents as unknown as { name: string } | null)?.name ?? "Unknown agent"
            const sourcePost = opp.posts as unknown as { posted_at: string | null; scraped_at: string | null } | null
            const postAge = formatPostAge(sourcePost?.posted_at ?? null, sourcePost?.scraped_at ?? null)

            return (
              <Card
                key={opp.id}
                className={cn(
                  "transition-all hover:shadow-md",
                  isHot ? "ring-1 ring-rose-500/40" : "hover:ring-1 hover:ring-brand/20"
                )}
              >
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{opp.author_name}</span>
                        <span className="text-xs uppercase text-muted-foreground">{opp.platform}</span>
                        {isHot && (
                          <Badge variant="destructive" className="uppercase tracking-wide">
                            <Flame className="h-2.5 w-2.5" />
                            Hot
                          </Badge>
                        )}
                      </div>
                      {postAge && (
                        <span
                          className="flex items-center gap-1 text-xs text-muted-foreground"
                          title={`Posted ${postAge.exact}`}
                        >
                          <Clock className="h-3 w-3" />
                          {postAge.label}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Agent: {agentName}
                        {opp.category ? ` · ${opp.category}` : ""}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge variant={URGENCY_VARIANT[opp.urgency] ?? "secondary"} className="capitalize">
                        {opp.urgency}
                      </Badge>
                      <DeleteOpportunityButton id={opp.id} name={opp.author_name} />
                    </div>
                  </div>

                  {opp.ai_summary && <p className="text-sm font-medium">{opp.ai_summary}</p>}

                  <details className="rounded-md bg-muted/30 p-2 text-sm text-muted-foreground">
                    <summary className="cursor-pointer text-xs">View Raw Social Post Text</summary>
                    <p className="mt-2 whitespace-pre-wrap">&quot;{opp.content}&quot;</p>
                  </details>

                  <div className="grid grid-cols-2 gap-3 border-y py-2 text-sm">
                    <div className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1 text-xs uppercase text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        Location
                      </span>
                      <span>{opp.location_mentioned || "Not specified"}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1 text-xs uppercase text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        Phone Number
                      </span>
                      {opp.phone_number ? (
                        <a href={`tel:${opp.phone_number}`} className="text-brand underline decoration-dotted underline-offset-2 hover:text-brand/80">
                          {opp.phone_number}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">Not stated</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">AI Confidence</span>
                      <span className="font-medium">{confidence}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand/70 to-brand transition-all"
                        style={{ width: `${confidence}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {opp.estimated_value && <span>Est. value: {opp.estimated_value}</span>}
                    {opp.post_url && (
                      <a
                        href={opp.post_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-brand"
                      >
                        View original post
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  <GenerateReplyButton
                    id={opp.id}
                    initialComment={opp.suggested_comment}
                    initialDm={opp.suggested_dm}
                  />

                  <SendOutreachButtons
                    id={opp.id}
                    platform={opp.platform}
                    hasComment={!!opp.suggested_comment}
                    hasDm={!!opp.suggested_dm}
                    hasPostUrl={!!opp.post_url}
                    hasProfileUrl={!!opp.author_profile_url}
                    commentSentAt={opp.comment_sent_at}
                    dmSentAt={opp.dm_sent_at}
                  />

                  {opp.status === "new" ? (
                    <ApproveRejectButtons id={opp.id} />
                  ) : (
                    <div className="flex items-center justify-between gap-4 pt-1">
                      <span className="text-xs text-muted-foreground">Pipeline status</span>
                      <StatusSelect id={opp.id} status={opp.status} />
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
