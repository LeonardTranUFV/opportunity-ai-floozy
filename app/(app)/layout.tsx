import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { PageTitle } from "@/components/page-title"
import { NotificationsBell } from "@/components/notifications-bell"
import { ThemeToggle } from "@/components/theme-toggle"
import { CreditBar } from "@/components/credit-bar"
import { PlanBadge } from "@/components/plan-badge"
import { MobileNav } from "@/components/mobile-nav"
import { TourProvider } from "@/components/tour/tour-provider"
import { TourOverlay } from "@/components/tour/tour-overlay"
import { createClient } from "@/lib/supabase/server"
import { isAdmin } from "@/lib/admin"
import { PLAN_ALLOWANCES, ensureTrialCredits, ensurePlanCredits } from "@/lib/credits"
import { getSubscriptionSummary, type SubscriptionSummary } from "@/lib/entitlement"
import { getConsent } from "@/lib/consent"
import { ConsentGate } from "@/components/consent-gate"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userIsAdmin = user ? await isAdmin(supabase, user.id) : false

  // Gate the whole signed-in app, not individual pages: the terms cover what
  // the product does at all, so there is no screen it would be right to let
  // someone use first. Rendered over the app rather than as a redirect so the
  // page behind it is already warm once they accept.
  const consent = user ? await getConsent(supabase, user.id) : null

  let credits: { balance: number; allowance: number } | null = null
  // Where they stand with billing, for the header badge. Asked for by name:
  // "show how many day free trial left on top corner" — and an upgrade
  // button, which until now existed only on the pricing page nobody
  // signed-in ever visits.
  let subscription: SubscriptionSummary | null = null
  if (user) {
    subscription = await getSubscriptionSummary(supabase, user.id)
    // Seed the trial balance before reading it. Nothing granted credits on
    // signup, so accounts started at zero and the first AI action they tried
    // answered "Out of credits — upgrade your plan", which reads as a paywall
    // rather than a bug. This runs on every authenticated page load but only
    // grants once, keyed off its own transaction record.
    await ensureTrialCredits(supabase, user.id)
    // And the credits their plan includes, if they are paying. Reconciled here
    // rather than granted by the Stripe webhook, because the webhook is the
    // part that can silently not happen — see ensurePlanCredits.
    await ensurePlanCredits(supabase, user.id)

    const { data } = await supabase
      .from("user_credits")
      .select("balance, plan")
      .eq("user_id", user.id)
      .maybeSingle()
    if (data) {
      credits = { balance: data.balance, allowance: PLAN_ALLOWANCES[data.plan] ?? data.balance }
    }
  }

  return (
    <SidebarProvider>
      <TourProvider>
      <AppSidebar userEmail={user?.email} isAdmin={userIsAdmin} />
      <div className="aurora-bg flex-1 w-full flex flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger />
          <div className="w-full flex justify-between items-center px-4">
            <PageTitle />
            <div className="flex shrink-0 items-center gap-1">
              {subscription && (
                <PlanBadge
                  state={subscription.state}
                  plan={subscription.plan}
                  daysLeft={subscription.daysLeft}
                />
              )}
              {credits && <CreditBar balance={credits.balance} allowance={credits.allowance} />}
              <ThemeToggle />
              <NotificationsBell />
            </div>
          </div>
        </header>
        {/* pb-24 on mobile keeps the last card clear of the fixed bottom bar. */}
        <main className="flex-1 overflow-y-auto p-4 pb-24 md:p-6 md:pb-6 lg:p-8">{children}</main>
      </div>
      <MobileNav />
      <TourOverlay />
      {consent && !consent.current && (
        <ConsentGate
          poolAlreadyOn={consent.poolOptIn}
          // Having a stored version at all means they accepted once before,
          // so this is a re-consent rather than a first one.
          returning={consent.termsVersion !== null}
        />
      )}
      </TourProvider>
    </SidebarProvider>
  )
}
