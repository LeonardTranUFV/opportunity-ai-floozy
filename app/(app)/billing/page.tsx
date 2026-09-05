import Link from "next/link"
import { Check, Gem, Sparkles, Clock, TriangleAlert, Radar, PenLine, Wand2, Search } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"
import { getSubscriptionSummary, getPlan, getSourceCapacity, ACTIVE_SOURCE_LIMITS } from "@/lib/entitlement"
import { PLAN_ALLOWANCES, CREDIT_COSTS } from "@/lib/credits"
import { packRateFor, packsEnabled, planCentsPerCredit, formatCad } from "@/lib/credit-packs"
import { BuyCredits } from "@/components/billing/buy-credits"
import { formatDate } from "@/lib/format-date"

export const dynamic = "force-dynamic"

/**
 * The plan page for someone already signed in.
 *
 * Until this existed, every "Upgrade" and every click on the credit bar led
 * to /pricing — the public funnel, with "See the leads before your
 * competitors even look" and a "Run my free scan" button — shown to a
 * customer who had already run the scan, made the account, and possibly
 * paid. What they wanted was three things: what plan am I on, how many
 * credits do I have, and how do I get more. This page answers those in that
 * order and nothing else.
 *
 * Plans still check out through the payment links in /api/checkout; packs go
 * through /api/credits/checkout. Prices shown here are display copies of the
 * ones on /pricing and in Stripe — change them there first.
 */

const PLAN_LABEL: Record<string, string> = { trial: "Free trial", weekly: "Weekly", monthly: "Monthly" }

/** The comparison rows. Feature text mirrors app/pricing/page.tsx. */
const PLANS = [
  {
    key: "trial",
    name: "Free trial",
    price: "$0",
    period: "once",
    credits: `${PLAN_ALLOWANCES.trial} credits to start`,
    features: ["Everything switched on so you can judge it", "Scans and drafts until the credits run out", "Buy a pack any time to keep going"],
  },
  {
    key: "weekly",
    name: "Weekly",
    price: "$49",
    period: "/week",
    credits: `${PLAN_ALLOWANCES.weekly} credits a week`,
    features: ["3 days free, then $49 a week — cancel any time", "Connect Facebook, LinkedIn, Nextdoor or X", "AI-drafted first messages"],
    href: "/api/checkout?plan=weekly",
  },
  {
    key: "monthly",
    name: "Monthly",
    price: "$149",
    period: "/month",
    credits: `${PLAN_ALLOWANCES.monthly} credits a month`,
    features: ["Everything in Weekly, and $47 a month cheaper", "Unlimited agents — more trades, more cities", "Priority setup help"],
    href: "/api/checkout?plan=monthly",
    highlighted: true,
  },
] as const

const CREDIT_USES = [
  { icon: Radar, label: "Scan a batch of up to 100 posts", cost: CREDIT_COSTS.scanBatch },
  { icon: PenLine, label: "Draft or redraft one reply", cost: CREDIT_COSTS.draftGeneration },
  { icon: Wand2, label: "Set up an agent with AI", cost: CREDIT_COSTS.agentSetup },
  { icon: Sparkles, label: "AI shortlist of groups to join", cost: CREDIT_COSTS.groupRecommendations },
  { icon: Search, label: "Search Facebook live for groups", cost: CREDIT_COSTS.discoverGroups },
]

export default async function BillingPage(props: { searchParams: Promise<{ purchased?: string }> }) {
  const { purchased } = await props.searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const [subscription, plan, capacity, creditsRow] = await Promise.all([
    getSubscriptionSummary(supabase, user.id),
    getPlan(supabase, user.id),
    getSourceCapacity(supabase, user.id),
    supabase.from("user_credits").select("balance, plan").eq("user_id", user.id).maybeSingle(),
  ])

  const balance = creditsRow.data?.balance ?? 0
  const allowance = PLAN_ALLOWANCES[creditsRow.data?.plan ?? plan] ?? PLAN_ALLOWANCES.trial
  const pct = allowance > 0 ? Math.max(0, Math.min(100, (balance / allowance) * 100)) : 0
  const paying = subscription.state === "trialing" || subscription.state === "active" || subscription.state === "past_due"
  const planName = PLAN_LABEL[plan] ?? plan
  const packRate = packRateFor(plan)
  const purchasedCredits = Number(purchased)

  return (
    <div className="flex flex-col gap-6">
      {Number.isInteger(purchasedCredits) && purchasedCredits > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <div className="font-medium">Payment received.</div>
            <div className="text-muted-foreground">
              {purchasedCredits} credits are being added to your balance — refresh in a moment if you don&apos;t see them yet.
            </div>
          </div>
        </div>
      )}

      {/* ── Where you stand ─────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Your plan
              <PlanState state={subscription.state} />
            </CardTitle>
            <CardDescription>
              {subscription.state === "free" &&
                "You're on the free trial. Pick a plan below when you want credits every period and the groups that come with it."}
              {subscription.state === "trialing" &&
                `Your ${planName.toLowerCase()} plan starts billing ${
                  subscription.periodEnd ? `on ${formatDate(subscription.periodEnd)}` : "when the trial ends"
                }. Cancel any time from the email Stripe sent you.`}
              {subscription.state === "active" &&
                `Renews ${subscription.periodEnd ? formatDate(subscription.periodEnd) : "each period"}. Manage or cancel from the email Stripe sent you.`}
              {subscription.state === "past_due" &&
                "Your last payment failed and Stripe is retrying. Update your card from the email Stripe sent you — everything keeps working in the meantime."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="font-heading text-3xl font-semibold">{planName}</span>
              {paying && subscription.plan && (
                <span className="text-sm text-muted-foreground">
                  {subscription.plan === "weekly" ? "$49 a week" : "$149 a month"}
                </span>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-border p-3">
                <dt className="text-xs text-muted-foreground">Monitored groups</dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {capacity.unlimited ? `${capacity.used} · no limit` : `${capacity.used} of ${capacity.limit}`}
                </dd>
              </div>
              <div className="rounded-lg border border-border p-3">
                <dt className="text-xs text-muted-foreground">Credits per period</dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {plan === "trial" ? `${PLAN_ALLOWANCES.trial} once` : `${allowance} / ${plan === "weekly" ? "week" : "month"}`}
                </dd>
              </div>
            </dl>
            {capacity.unlimited && (
              <p className="text-xs text-muted-foreground">
                This account has admin / pool access, so the group limit doesn&apos;t apply to it.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gem className="size-4 text-brand" />
              Credits
            </CardTitle>
            <CardDescription>Only AI actions cost credits. Sending a reply from your own account is free.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="font-heading text-3xl font-semibold tabular-nums">{balance}</span>
                <span className="text-sm text-muted-foreground tabular-nums">of {allowance}</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-600" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {paying && subscription.periodEnd
                  ? `${allowance} more arrive ${formatDate(subscription.periodEnd)}. Bought packs never expire.`
                  : "Trial credits don't renew. A plan adds credits every period; a pack adds them now."}
              </p>
            </div>
            <ul className="flex flex-col gap-1.5 text-sm">
              {CREDIT_USES.map(({ icon: Icon, label, cost }) => (
                <li key={label} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Icon className="size-3.5 shrink-0" />
                    {label}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {cost} credit{cost === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* ── Buy more ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Buy more credits</CardTitle>
          <CardDescription>
            Top up without changing your plan. Packs on the {planName.toLowerCase()} plan are {formatCad(packRate)} a
            credit{plan !== "monthly" ? " — the monthly plan gets the cheapest packs" : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BuyCredits centsPerCredit={packRate} planLabel={planName.toLowerCase()} enabled={packsEnabled()} />
        </CardContent>
      </Card>

      {/* ── Compare plans ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Compare plans</CardTitle>
          <CardDescription>
            Prices in CAD. Both paid plans start with a 3-day free trial.
            {paying && " To switch plans, cancel the current one from Stripe's email first — starting a second checkout would create a second subscription."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {PLANS.map((p) => {
              const current = p.key === plan
              const perCredit = planCentsPerCredit(p.key)
              return (
                <div
                  key={p.key}
                  className={`relative flex flex-col gap-3 rounded-xl border p-4 ${
                    current ? "border-brand ring-1 ring-brand" : "border-border"
                  }`}
                >
                  {current && (
                    <Badge variant="brand" className="absolute -top-2.5 left-4">
                      Your plan
                    </Badge>
                  )}
                  <div>
                    <div className="text-sm font-semibold">{p.name}</div>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="font-heading text-2xl font-semibold tracking-tight">{p.price}</span>
                      <span className="text-xs text-muted-foreground">{p.period}</span>
                    </div>
                  </div>
                  <dl className="flex flex-col gap-1 text-xs text-muted-foreground">
                    <div className="flex justify-between gap-2">
                      <dt>Credits</dt>
                      <dd className="text-right text-foreground">{p.credits}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Cost per credit</dt>
                      <dd className="text-right text-foreground tabular-nums">
                        {perCredit === null ? "—" : `${perCredit.toFixed(1)}¢`}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Credit packs</dt>
                      <dd className="text-right text-foreground tabular-nums">{formatCad(packRateFor(p.key))} each</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Monitored groups</dt>
                      <dd className="text-right text-foreground tabular-nums">{ACTIVE_SOURCE_LIMITS[p.key]} at a time</dd>
                    </div>
                  </dl>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-brand" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-1">
                    {"href" in p && !current && !paying ? (
                      <Button
                        variant={"highlighted" in p && p.highlighted ? "brand" : "outline"}
                        className="w-full"
                        nativeButton={false}
                        render={<Link href={p.href} />}
                      >
                        Start 3-day trial
                      </Button>
                    ) : current ? (
                      <div className="text-center text-xs text-muted-foreground">Current plan</div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function PlanState({ state }: { state: "free" | "trialing" | "active" | "past_due" }) {
  if (state === "trialing")
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="size-3" /> Trial
      </Badge>
    )
  if (state === "active") return <Badge variant="success">Active</Badge>
  if (state === "past_due")
    return (
      <Badge variant="warning" className="gap-1">
        <TriangleAlert className="size-3" /> Payment failed
      </Badge>
    )
  return null
}
