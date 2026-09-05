import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { buttonVariants } from "@/components/ui/button"
import { Plus, MapPin, Target, Bot } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { DeleteAgentButton } from "@/components/agents/delete-agent-button"
import { ScanAgentButton } from "@/components/agents/scan-agent-button"
import { AutoScanSelect } from "@/components/agents/auto-scan-select"
import { StaleSourcesBanner } from "@/components/agents/stale-sources-banner"
import { dedupeOpportunities } from "@/lib/dedupe-opportunities"

export const dynamic = "force-dynamic"

const STALE_AFTER_MS = 24 * 60 * 60 * 1000

export default async function AgentsPage() {
  const supabase = await createClient()

  const { data: agents } = await supabase
    .from("agents")
    .select("*")
    .order("created_at", { ascending: false })

  const agentIds = (agents ?? []).map((a) => a.id)
  // Counted after collapsing duplicates, so "706 opportunities found"
  // becomes the 223 the customer can actually act on. The columns are what
  // the collapse needs to pick a survivor; see lib/dedupe-opportunities.ts.
  const { data: opportunityRows } = agentIds.length
    ? await supabase
        .from("opportunities")
        .select("id, agent_id, content, status, author_name, author_profile_url, post_url, comment_sent_at, dm_sent_at, created_at")
        .in("agent_id", agentIds)
    : { data: [] }

  const countByAgent = new Map<string, number>()
  for (const o of dedupeOpportunities(opportunityRows ?? [])) {
    if (o.agent_id) countByAgent.set(o.agent_id, (countByAgent.get(o.agent_id) ?? 0) + 1)
  }

  const { data: activeGroups } = await supabase.from("groups").select("last_scraped_at").eq("active", true)
  const lastRefreshedAt = (activeGroups ?? []).reduce<string | null>((latest, g) => {
    if (!g.last_scraped_at) return latest
    return !latest || g.last_scraped_at > latest ? g.last_scraped_at : latest
  }, null)
  const sourcesAreStale =
    (activeGroups?.length ?? 0) > 0 &&
    // Server Component: this renders once per request on the server, never on
    // the client, so "now" cannot drift between renders or mismatch during
    // hydration. The purity rule cannot tell the two component kinds apart.
    // eslint-disable-next-line react-hooks/purity
    (!lastRefreshedAt || Date.now() - new Date(lastRefreshedAt).getTime() > STALE_AFTER_MS)

  return (
    <div className="flex flex-col gap-6">
      {/* Stacked below sm. A 3xl title, a sentence, and a button in one row
          leaves the sentence a ribbon three words wide at 375px. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight">AI Agents</h2>
          <p className="text-muted-foreground">
            Each agent independently searches for a specific kind of opportunity.
          </p>
        </div>
        <Link href="/agents/new" className={`${buttonVariants({ variant: "brand" })} w-full sm:w-auto`}>
          <Plus />
          New Agent
        </Link>
      </div>

      {sourcesAreStale && <StaleSourcesBanner />}

      {!agents || agents.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <EmptyState
              icon={Bot}
              title="You haven't created any AI agents yet"
              description="An agent is what tells the AI what to look for, where, and how urgently to alert you."
              action={
                <Link href="/agents/new" className={buttonVariants({ variant: "brand" })}>
                  <Plus />
                  Create your first agent
                </Link>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Card key={agent.id} className="transition-all hover:shadow-md hover:ring-1 hover:ring-brand/20">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/15">
                    <Bot className="h-4 w-4" />
                  </div>
                  <CardTitle>{agent.name}</CardTitle>
                </div>
                <CardDescription>{agent.goal}</CardDescription>
              </CardHeader>
              <CardContent className="flex h-full flex-col gap-3">
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
                      .map((k: string) => k.trim())
                      .filter(Boolean)
                      .map((k: string) => (
                        <Badge key={k} variant="outline" className="font-normal text-muted-foreground">
                          {k}
                        </Badge>
                      ))}
                  </div>
                )}
                <div className="flex-1" />
                <div className="flex items-center justify-between pt-2">
                  <Link
                    href={`/opportunities?agent=${agent.id}`}
                    className="flex items-center gap-1.5 text-sm text-brand underline decoration-dotted underline-offset-4 hover:text-brand/80"
                  >
                    <Target className="h-3.5 w-3.5" />
                    <span className="font-medium">{countByAgent.get(agent.id) ?? 0}</span>
                    <span>opportunities found →</span>
                  </Link>
                  <DeleteAgentButton id={agent.id} name={agent.name} />
                </div>
                <ScanAgentButton id={agent.id} />
                <AutoScanSelect id={agent.id} intervalHours={agent.auto_scan_interval_hours} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
