import { Card, CardContent } from "@/components/ui/card"
import { MapPin, Phone, ExternalLink, Flame, Search } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { StatusSelect } from "@/components/opportunities/status-select"
import { GenerateReplyButton } from "@/components/opportunities/generate-reply-button"
import { ApproveRejectButtons } from "@/components/opportunities/approve-reject-buttons"
import { SendOutreachButtons } from "@/components/opportunities/send-outreach-buttons"
import { DeleteOpportunityButton } from "@/components/opportunities/delete-opportunity-button"

export const dynamic = "force-dynamic"

const URGENCY_STYLES: Record<string, string> = {
  asap: "bg-destructive/10 text-destructive",
  high: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  medium: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  low: "bg-muted text-muted-foreground",
}

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; urgency?: string; status?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: agents } = await supabase.from("agents").select("id, name").order("name")

  let query = supabase
    .from("opportunities")
    .select("*, agents(name)")
    .order("intent_score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100)

  if (params.agent) query = query.eq("agent_id", params.agent)
  if (params.urgency) query = query.eq("urgency", params.urgency)
  if (params.status) {
    query = query.eq("status", params.status)
  } else {
    // Default view hides rejected opportunities so "Reject" reads as removal —
    // they're still visible via Status → Lost here, and always in the CRM's Lost column.
    query = query.neq("status", "lost")
  }

  const { data: opportunities } = await query

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Opportunities</h2>
        <p className="text-muted-foreground">
          Everything your AI agents have found, ranked by intent score.
        </p>
      </div>

      <form className="flex flex-wrap gap-3" method="get">
        <select
          name="agent"
          defaultValue={params.agent || ""}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">All Agents</option>
          {agents?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          name="urgency"
          defaultValue={params.urgency || ""}
          className="h-8 rounded-md border bg-background px-2 text-sm capitalize"
        >
          <option value="">All Urgency</option>
          <option value="asap">ASAP</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          name="status"
          defaultValue={params.status || ""}
          className="h-8 rounded-md border bg-background px-2 text-sm capitalize"
        >
          <option value="">All Status</option>
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
          <option value="qualified">Qualified</option>
          <option value="appointment">Appointment</option>
          <option value="proposal">Proposal</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
        <button type="submit" className="h-8 rounded-md border px-3 text-sm hover:bg-muted">
          Filter
        </button>
      </form>

      {!opportunities || opportunities.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              No opportunities match these filters yet. Go to{" "}
              <a href="/agents" className="underline">
                AI Agents
              </a>{" "}
              and run a scan to find new ones.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {opportunities.map((opp) => {
            const isHot = (opp.intent_score ?? 0) >= 90 || opp.urgency === "asap"
            const confidence = Math.max(0, Math.min(100, opp.intent_score ?? 0))
            const agentName = (opp.agents as unknown as { name: string } | null)?.name ?? "Unknown agent"

            return (
              <Card
                key={opp.id}
                className={`transition-shadow hover:shadow-md ${isHot ? "ring-1 ring-rose-500/30" : ""}`}
              >
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{opp.author_name}</span>
                        <span className="text-xs uppercase text-muted-foreground">{opp.platform}</span>
                        {isHot && (
                          <span className="flex items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-destructive">
                            <Flame className="h-2.5 w-2.5" />
                            Hot
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Agent: {agentName}
                        {opp.category ? ` · ${opp.category}` : ""}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                          URGENCY_STYLES[opp.urgency] || URGENCY_STYLES.low
                        }`}
                      >
                        {opp.urgency}
                      </span>
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
                        <a href={`tel:${opp.phone_number}`} className="text-blue-600 underline dark:text-blue-400">
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
                      <div className="h-full rounded-full bg-blue-600" style={{ width: `${confidence}%` }} />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {opp.estimated_value && <span>Est. value: {opp.estimated_value}</span>}
                    {opp.post_url && (
                      <a
                        href={opp.post_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 underline"
                      >
                        View original post
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  <GenerateReplyButton id={opp.id} initialReply={opp.suggested_reply} />

                  <SendOutreachButtons
                    id={opp.id}
                    platform={opp.platform}
                    hasReply={!!opp.suggested_reply}
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
