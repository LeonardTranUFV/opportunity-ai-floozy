import { Card, CardContent } from "@/components/ui/card"
import { MapPin, ExternalLink } from "lucide-react"
import { db as opportunityDb } from "@/lib/db/schema"
import { StatusSelect } from "@/components/opportunities/status-select"
import { GenerateReplyButton } from "@/components/opportunities/generate-reply-button"

export const dynamic = "force-dynamic"

interface OpportunityRow {
  id: number
  agent_id: number
  agent_name: string
  platform: string
  author_name: string
  post_url: string | null
  location_mentioned: string | null
  content: string
  category: string | null
  intent_score: number | null
  urgency: string
  estimated_value: string | null
  ai_summary: string | null
  suggested_reply: string | null
  status: string
  created_at: string
}

interface AgentOption {
  id: number
  name: string
}

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
  const agents = opportunityDb.prepare("SELECT id, name FROM agents ORDER BY name").all() as AgentOption[]

  const conditions: string[] = []
  const values: (string | number)[] = []

  if (params.agent) {
    conditions.push("opportunities.agent_id = ?")
    values.push(Number(params.agent))
  }
  if (params.urgency) {
    conditions.push("opportunities.urgency = ?")
    values.push(params.urgency)
  }
  if (params.status) {
    conditions.push("opportunities.status = ?")
    values.push(params.status)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

  const opportunities = opportunityDb
    .prepare(
      `SELECT opportunities.*, agents.name as agent_name
       FROM opportunities
       JOIN agents ON agents.id = opportunities.agent_id
       ${where}
       ORDER BY opportunities.intent_score DESC, opportunities.created_at DESC
       LIMIT 100`
    )
    .all(...values) as OpportunityRow[]

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
          {agents.map((a) => (
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

      {opportunities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No opportunities match these filters yet. Go to{" "}
            <a href="/agents" className="underline">
              AI Agents
            </a>{" "}
            and run a scan to find new ones.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {opportunities.map((opp) => (
            <Card key={opp.id}>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{opp.author_name}</span>
                      <span className="text-xs uppercase text-muted-foreground">{opp.platform}</span>
                      {opp.location_mentioned && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {opp.location_mentioned}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Agent: {opp.agent_name}
                      {opp.category ? ` · ${opp.category}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        URGENCY_STYLES[opp.urgency] || URGENCY_STYLES.low
                      }`}
                    >
                      {opp.urgency}
                    </span>
                    <span className="text-xs text-muted-foreground">Intent {opp.intent_score ?? "—"}</span>
                  </div>
                </div>

                {opp.ai_summary && <p className="text-sm font-medium">{opp.ai_summary}</p>}
                <p className="rounded-md bg-muted/30 p-2 text-sm text-muted-foreground">
                  &quot;{opp.content}&quot;
                </p>

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

                <div className="flex items-center justify-between gap-4 pt-1">
                  <StatusSelect id={opp.id} status={opp.status} />
                </div>

                <GenerateReplyButton id={opp.id} initialReply={opp.suggested_reply} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
