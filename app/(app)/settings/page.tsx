import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { CheckCircle2, XCircle, Gem, Radar } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { SettingsForm } from "@/components/settings/settings-form"
import { BusinessProfileForm } from "@/components/settings/business-profile-form"
import { GhlToggle } from "@/components/settings/ghl-toggle"
import { PLAN_ALLOWANCES } from "@/lib/credits"
import { platformMeta } from "@/lib/platform-meta"

export const dynamic = "force-dynamic"

function maskKey(key: string | undefined): string {
  if (!key) return "Not configured"
  if (key.length <= 8) return "••••••••"
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}

function formatWhen(iso: string | null): string {
  if (!iso) return "Never"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "Never"
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

const REASON_LABELS: Record<string, string> = {
  scan_batch: "Scanned a batch of posts",
  draft_generation: "Generated an outreach draft",
  admin_grant: "Credits added",
  admin_deduct: "Credits removed",
  monthly_allowance: "Monthly allowance",
  top_up_purchase: "Credit pack purchased",
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: rows } = await supabase.from("settings").select("key, value")
  const settingsMap = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]))

  const integrations = [
    { name: "Gemini API (AI reasoning)", key: process.env.GEMINI_API_KEY },
    { name: "GoHighLevel (CRM dispatch)", key: process.env.GHL_API_KEY },
  ]

  const ghlDispatchEnabled = settingsMap.ghl_dispatch_enabled === "true"

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let creditSummary: { balance: number; allowance: number } | null = null
  let transactions: { id: string; amount: number; reason: string; balance_after: number; created_at: string }[] = []
  if (user) {
    const [{ data: creditRow }, { data: txRows }] = await Promise.all([
      supabase.from("user_credits").select("balance, plan").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("credit_transactions")
        .select("id, amount, reason, balance_after, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10),
    ])
    if (creditRow) {
      creditSummary = { balance: creditRow.balance, allowance: PLAN_ALLOWANCES[creditRow.plan] ?? creditRow.balance }
    }
    transactions = txRows ?? []
  }

  const { data: groupRows } = await supabase
    .from("groups")
    .select("id, platform, name, active, last_scraped_at")
    .order("last_scraped_at", { ascending: false, nullsFirst: false })

  const groupIds = (groupRows ?? []).map((g) => g.id)
  const { data: postsForGroups } = groupIds.length
    ? await supabase.from("posts").select("group_id").in("group_id", groupIds)
    : { data: [] as { group_id: string }[] }
  const postCountByGroup = new Map<string, number>()
  for (const p of postsForGroups ?? []) {
    postCountByGroup.set(p.group_id, (postCountByGroup.get(p.group_id) ?? 0) + 1)
  }
  const scrapeActivity = (groupRows ?? []).map((g) => ({ ...g, post_count: postCountByGroup.get(g.id) ?? 0 }))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Configure how the AI reasons about opportunities and check your integrations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Business Profile</CardTitle>
          <CardDescription>
            Optional, but recommended — used to personalize AI-generated replies so they sound like you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BusinessProfileForm
            initialOwnerName={settingsMap.business_owner_name || ""}
            initialBusinessName={settingsMap.business_name || ""}
            initialPhone={settingsMap.business_phone || ""}
            initialPitch={settingsMap.business_pitch || ""}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Persona</CardTitle>
          <CardDescription>
            Default reasoning settings used across the platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm
            initialGoal={settingsMap.ai_goal || "home_services"}
            initialLanguages={settingsMap.ai_languages || "English"}
            initialCustomRules={settingsMap.ai_custom_rules || ""}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>API keys are read from your .env file — never edited here.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {integrations.map((integration) => (
            <div
              key={integration.name}
              className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm"
            >
              <span className="font-medium">{integration.name}</span>
              <span className="flex items-center gap-2 text-muted-foreground">
                {integration.key ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <code className="rounded bg-background px-1.5 py-0.5 text-xs ring-1 ring-border">
                  {maskKey(integration.key)}
                </code>
              </span>
            </div>
          ))}
          <GhlToggle initialEnabled={ghlDispatchEnabled} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gem className="h-4 w-4 text-brand" />
            Credit Usage
          </CardTitle>
          <CardDescription>
            {creditSummary
              ? `${creditSummary.balance} of ${creditSummary.allowance} credits left this cycle. Unused credits roll over.`
              : "Credit tracking isn't set up on this account yet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <EmptyState
              icon={Gem}
              title="No credit activity yet"
              description="Scans and draft generations will show up here as they happen."
            />
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">{REASON_LABELS[tx.reason] ?? tx.reason}</span>
                    <span className="text-xs text-muted-foreground">{formatWhen(tx.created_at)}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className={tx.amount < 0 ? "font-medium text-destructive" : "font-medium text-emerald-600 dark:text-emerald-400"}>
                      {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                    </span>
                    <span className="text-xs text-muted-foreground">{tx.balance_after} left</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-brand" />
            Scrape Activity
          </CardTitle>
          <CardDescription>When each community was last scraped and how many posts it's collected.</CardDescription>
        </CardHeader>
        <CardContent>
          {scrapeActivity.length === 0 ? (
            <EmptyState
              icon={Radar}
              title="No communities yet"
              description="Add a community to start collecting posts."
            />
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {scrapeActivity.map((g) => {
                const { label, Icon, iconColor } = platformMeta(g.platform)
                return (
                  <div key={g.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${iconColor}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="truncate font-medium">{g.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {label} · {g.post_count} posts collected
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!g.active && <Badge variant="outline">Paused</Badge>}
                      <span className="text-xs text-muted-foreground">{formatWhen(g.last_scraped_at)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Agents</CardTitle>
          <CardDescription>
            Each agent has its own goal, location, and keywords — manage them from the{" "}
            <a href="/agents" className="text-brand underline decoration-dotted underline-offset-4 hover:text-brand/80">
              AI Agents
            </a>{" "}
            page.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
