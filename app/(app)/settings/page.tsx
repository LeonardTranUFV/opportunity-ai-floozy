import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { CheckCircle2, XCircle, Gem, Radar } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { SettingsForm } from "@/components/settings/settings-form"
import { BusinessProfileForm } from "@/components/settings/business-profile-form"
import { GhlToggle } from "@/components/settings/ghl-toggle"
import { PrivacyModeToggle } from "@/components/settings/privacy-mode-toggle"
import { CreditsPanel, type CreditTx } from "@/components/settings/credits-panel"
import { PLAN_ALLOWANCES } from "@/lib/credits"
import { platformMeta } from "@/lib/platform-meta"
import { formatDate } from "@/lib/format-date"

export const dynamic = "force-dynamic"

function maskKey(key: string | undefined): string {
  if (!key) return "Not configured"
  if (key.length <= 8) return "â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
  return `${key.slice(0, 4)}â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢${key.slice(-4)}`
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
  return formatDate(date)
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: rows } = await supabase.from("settings").select("key, value")
  const settingsMap = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]))

  const integrations = [
    { name: "Gemini API (AI reasoning)", key: process.env.GEMINI_API_KEY },
    { name: "GoHighLevel (CRM dispatch)", key: process.env.GHL_API_KEY },
    // Reddit is the only source type that collects without a signed-in
    // browser, so on the hosted deployment it decides whether a customer sees
    // opportunities or an empty dashboard. Worth its own row rather than
    // letting a missing key surface only as a scrape failure.
    { name: "Reddit API (works without a browser)", key: process.env.REDDIT_CLIENT_ID },
  ]

  const ghlDispatchEnabled = settingsMap.ghl_dispatch_enabled === "true"
  const privacyModeEnabled = settingsMap.privacy_mode === "on"

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let creditSummary: { balance: number; allowance: number; plan: string } | null = null
  let transactions: CreditTx[] = []
  if (user) {
    const [{ data: creditRow }, { data: txRows }] = await Promise.all([
      supabase.from("user_credits").select("balance, plan").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("credit_transactions")
        .select("id, amount, reason, balance_after, created_at, metadata")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200),
    ])
    if (creditRow) {
      creditSummary = {
        balance: creditRow.balance,
        allowance: PLAN_ALLOWANCES[creditRow.plan] ?? creditRow.balance,
        plan: creditRow.plan,
      }
    }
    transactions = (txRows ?? []) as CreditTx[]
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
            Optional, but recommended â€” used to personalize AI-generated replies so they sound like you.
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
          <CardDescription>API keys are read from your .env file â€” never edited here.</CardDescription>
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
          <PrivacyModeToggle initialEnabled={privacyModeEnabled} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gem className="h-4 w-4 text-brand" />
            Credits &amp; Billing
          </CardTitle>
          <CardDescription>
            {creditSummary
              ? "Every credit spent, what it went to, and your plan. Unused credits roll over."
              : "Credit tracking isn't set up on this account yet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreditsPanel
            balance={creditSummary?.balance ?? null}
            allowance={creditSummary?.allowance ?? null}
            plan={creditSummary?.plan ?? null}
            transactions={transactions}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-brand" />
            Source Activity
          </CardTitle>
          <CardDescription>When each community was last checked and how many posts it's collected.</CardDescription>
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
                          {label} Â· {g.post_count} posts collected
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
            Each agent has its own goal, location, and keywords â€” manage them from the{" "}
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
