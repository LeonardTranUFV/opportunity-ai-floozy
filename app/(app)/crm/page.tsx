import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Briefcase } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { StatusSelect } from "@/components/opportunities/status-select"
import { isPrivacyMode, maskName } from "@/lib/privacy-mode"
import { dedupeOpportunities } from "@/lib/dedupe-opportunities"

export const dynamic = "force-dynamic"

const COLUMNS = [
  { key: "new", label: "New", dot: "bg-blue-500" },
  { key: "contacted", label: "Contacted", dot: "bg-amber-500" },
  { key: "qualified", label: "Qualified", dot: "bg-teal-500" },
  { key: "appointment", label: "Appointment", dot: "bg-cyan-500" },
  { key: "proposal", label: "Proposal", dot: "bg-indigo-500" },
  { key: "won", label: "Won", dot: "bg-emerald-500" },
  { key: "lost", label: "Lost", dot: "bg-red-500" },
] as const

export default async function CrmPage() {
  const supabase = await createClient()

  const { data: rawOpportunities } = await supabase
    .from("opportunities")
    .select("id, agent_id, status, intent_score, urgency, ai_summary, content, author_name, author_profile_url, post_url, comment_sent_at, dm_sent_at, created_at, estimated_value, agents(name)")
    .order("intent_score", { ascending: false })
  const opportunities = rawOpportunities ? dedupeOpportunities(rawOpportunities) : rawOpportunities

  const privacyMode = await isPrivacyMode(supabase)

  const byStatus = new Map<string, typeof opportunities>()
  for (const col of COLUMNS) byStatus.set(col.key, [])
  for (const opp of opportunities ?? []) {
    if (!byStatus.has(opp.status)) byStatus.set(opp.status, [])
    byStatus.get(opp.status)!.push(opp)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">CRM Pipeline</h2>
        <p className="text-muted-foreground">
          Track every opportunity from first contact to closed deal.
        </p>
      </div>

      {!opportunities || opportunities.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <EmptyState
              icon={Briefcase}
              title="No opportunities yet"
              description="Run a scan from AI Agents to populate your pipeline."
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
        // A board sideways, a list downwards. Seven 288px columns scrolled
        // horizontally is a pipeline on a desktop and about two thousand
        // pixels of one-handed swiping on a phone — five columns of it to
        // reach "Won", most of them empty. Below sm the same columns stack,
        // and empty ones are dropped: their only job on a board is to be a
        // drop target, and nothing is dragged here — status changes through
        // the select on each card.
        <div className="flex flex-col gap-4 pb-4 sm:flex-row sm:overflow-x-auto">
          {COLUMNS.map((col) => {
            const items = byStatus.get(col.key) || []
            return (
              <div
                key={col.key}
                className={`w-full flex-col gap-3 sm:flex sm:w-72 sm:shrink-0 ${
                  items.length === 0 ? "hidden" : "flex"
                }`}
              >
                <div className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                    {col.label}
                  </h3>
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
                    {items.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((opp) => {
                    const agentName = (opp.agents as unknown as { name: string } | null)?.name ?? "Unknown agent"
                    return (
                      <Card
                        key={opp.id}
                        size="sm"
                        className="transition-all hover:shadow-md hover:ring-1 hover:ring-brand/20"
                      >
                        <CardContent className="flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">{maskName(opp.author_name, privacyMode)}</span>
                            <span className="shrink-0 rounded-full bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand">
                              {opp.intent_score ?? "—"}
                            </span>
                          </div>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{opp.ai_summary || opp.content}</p>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="truncate">{agentName}</span>
                            {opp.estimated_value && <span className="shrink-0">{opp.estimated_value}</span>}
                          </div>
                          <StatusSelect id={opp.id} status={opp.status} />
                        </CardContent>
                      </Card>
                    )
                  })}
                  {items.length === 0 && (
                    // Desktop only — on a phone the whole column is gone.
                    <div className="hidden rounded-md border border-dashed border-border/70 px-2 py-4 text-center text-xs text-muted-foreground/70 sm:block">
                      Nothing here
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
