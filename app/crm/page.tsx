import { Card, CardContent } from "@/components/ui/card"
import { db as opportunityDb } from "@/lib/db/schema"
import { StatusSelect } from "@/components/opportunities/status-select"

export const dynamic = "force-dynamic"

interface OpportunityRow {
  id: number
  agent_name: string
  author_name: string
  ai_summary: string | null
  content: string
  intent_score: number | null
  urgency: string
  status: string
  estimated_value: string | null
}

const COLUMNS = [
  { key: "new", label: "New Lead" },
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Qualified" },
  { key: "appointment", label: "Appointment" },
  { key: "proposal", label: "Proposal" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
] as const

export default function CrmPage() {
  const opportunities = opportunityDb
    .prepare(
      `SELECT opportunities.id, opportunities.status, opportunities.intent_score, opportunities.urgency,
              opportunities.ai_summary, opportunities.content, opportunities.author_name, opportunities.estimated_value,
              agents.name as agent_name
       FROM opportunities
       JOIN agents ON agents.id = opportunities.agent_id
       ORDER BY opportunities.intent_score DESC`
    )
    .all() as OpportunityRow[]

  const byStatus = new Map<string, OpportunityRow[]>()
  for (const col of COLUMNS) byStatus.set(col.key, [])
  for (const opp of opportunities) {
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

      {opportunities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No opportunities yet. Run a scan from{" "}
            <a href="/agents" className="underline">
              AI Agents
            </a>{" "}
            to populate your pipeline.
          </CardContent>
        </Card>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => {
            const items = byStatus.get(col.key) || []
            return (
              <div key={col.key} className="flex w-72 shrink-0 flex-col gap-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-sm font-semibold">{col.label}</h3>
                  <span className="text-xs text-muted-foreground">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((opp) => (
                    <Card key={opp.id} size="sm">
                      <CardContent className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{opp.author_name}</span>
                          <span className="text-xs text-muted-foreground">{opp.intent_score ?? "—"}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {opp.ai_summary || opp.content}
                        </p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{opp.agent_name}</span>
                          {opp.estimated_value && <span>{opp.estimated_value}</span>}
                        </div>
                        <StatusSelect id={opp.id} status={opp.status} />
                      </CardContent>
                    </Card>
                  ))}
                  {items.length === 0 && (
                    <p className="px-1 text-xs text-muted-foreground">Nothing here</p>
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
