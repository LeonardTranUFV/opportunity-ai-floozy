import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { Plus, MapPin, Target } from "lucide-react"
import { db as opportunityDb } from "@/lib/db/schema"
import { DeleteAgentButton } from "@/components/agents/delete-agent-button"

export const dynamic = "force-dynamic"

interface AgentRow {
  id: number
  name: string
  goal: string
  location: string | null
  keywords: string | null
  negative_keywords: string | null
  created_at: string
  opportunity_count: number
}

export default function AgentsPage() {
  const agents = opportunityDb
    .prepare(
      `SELECT agents.*, COUNT(opportunities.id) as opportunity_count
       FROM agents
       LEFT JOIN opportunities ON opportunities.agent_id = agents.id
       GROUP BY agents.id
       ORDER BY agents.created_at DESC`
    )
    .all() as AgentRow[]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight">AI Agents</h2>
          <p className="text-muted-foreground">
            Each agent independently searches for a specific kind of opportunity.
          </p>
        </div>
        <Link href="/agents/new" className={buttonVariants()}>
          <Plus />
          New Agent
        </Link>
      </div>

      {agents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              You haven&apos;t created any AI agents yet. An agent is what tells the AI what to look
              for, where, and how urgently to alert you.
            </p>
            <Link href="/agents/new" className={buttonVariants()}>
              <Plus />
              Create your first agent
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Card key={agent.id}>
              <CardHeader>
                <CardTitle>{agent.name}</CardTitle>
                <CardDescription>{agent.goal}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {agent.location && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {agent.location}
                  </div>
                )}
                {agent.keywords && (
                  <div className="flex flex-wrap gap-1.5">
                    {agent.keywords
                      .split(",")
                      .map((k) => k.trim())
                      .filter(Boolean)
                      .map((k) => (
                        <span
                          key={k}
                          className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {k}
                        </span>
                      ))}
                  </div>
                )}
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-1.5 text-sm">
                    <Target className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{agent.opportunity_count}</span>
                    <span className="text-muted-foreground">opportunities found</span>
                  </div>
                  <DeleteAgentButton id={agent.id} name={agent.name} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
