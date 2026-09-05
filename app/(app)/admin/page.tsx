import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { ShieldAlert, ShieldOff, Inbox, BadgeCheck } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdmin } from "@/lib/admin"
import { PLAN_ALLOWANCES } from "@/lib/credits"
import { CreditAdjustForm } from "@/components/admin/credit-adjust-form"

export const dynamic = "force-dynamic"

export default async function AdminPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !(await isAdmin(supabase, user.id))) {
    return (
      <Card>
        <CardContent className="py-6">
          <EmptyState
            icon={ShieldOff}
            title="Not authorized"
            description="This page is restricted to Floozy admins."
          />
        </CardContent>
      </Card>
    )
  }

  const adminSupabase = createAdminClient()
  const { data: authUsers } = await adminSupabase.auth.admin.listUsers({ perPage: 200 })
  const { data: creditRows, error: creditsTableError } = await adminSupabase
    .from("user_credits")
    .select("user_id, balance, plan, updated_at")

  if (creditsTableError) {
    return (
      <Card>
        <CardContent className="py-6">
          <EmptyState
            icon={ShieldAlert}
            title="Credit system not set up yet"
            description="Run supabase/migrations/0006_credits.sql in the Supabase SQL editor first (creates the user_credits and credit_transactions tables + the adjust_credits function)."
          />
        </CardContent>
      </Card>
    )
  }

  const creditsByUser = new Map((creditRows ?? []).map((r) => [r.user_id, r]))

  /**
   * People who asked for their scan by email.
   *
   * The free scan offers "leave your email and we'll send this list over", and
   * /api/scan/capture writes them here — and nothing has ever read them back.
   * The table has RLS on with no policies, so it is service-role only and no
   * page could reach it; every prospect captured since the scan launched has
   * been invisible. A promise nobody can see is a promise nobody can keep.
   *
   * Newest first, because a follow-up is worth most while the scan they ran is
   * still fresh in their mind.
   */
  const { data: scanRequests, error: scanRequestsError } = await adminSupabase
    .from("scan_requests")
    .select("id, email, phone, trade, city, results_found, consented_at, delivered_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-bold tracking-tight">Admin — Credits</h2>
        <p className="text-muted-foreground">
          Manually adjust any user&apos;s credit balance. Every change is logged with who made it and why.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            Plan allowances (granted each billing period, unused credits roll over): Trial{" "}
            {PLAN_ALLOWANCES.trial} · Weekly {PLAN_ALLOWANCES.weekly}/week · Monthly{" "}
            {PLAN_ALLOWANCES.monthly}/month
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(authUsers?.users ?? []).map((u) => {
            const credit = creditsByUser.get(u.id)
            return (
              <div key={u.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{u.email}</span>
                    <Badge variant="outline" className="capitalize">{credit?.plan ?? "no plan set"}</Badge>
                    <Badge variant={credit && credit.balance <= 0 ? "destructive" : "secondary"}>
                      {credit?.balance ?? 0} credits
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">{u.id}</span>
                </div>
                <CreditAdjustForm userId={u.id} />
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-brand" />
            Free-scan follow-ups
          </CardTitle>
          <CardDescription>
            People who ran the free scan and asked for the list by email. Nothing is sent
            automatically — this app has no mail provider — so these are yours to send by hand.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {scanRequestsError ? (
            <EmptyState
              icon={ShieldAlert}
              title="Capture table not set up yet"
              description="Run supabase/migrations/0014_scan_requests.sql in the Supabase SQL editor."
            />
          ) : (scanRequests ?? []).length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No requests yet"
              description="They appear here the moment somebody asks for their scan by email."
            />
          ) : (
            (scanRequests ?? []).map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`mailto:${r.email}?subject=${encodeURIComponent(
                        `Who's asking for a ${r.trade} near ${r.city}`
                      )}`}
                      className="truncate text-sm font-medium text-brand underline decoration-dotted underline-offset-2"
                    >
                      {r.email}
                    </a>
                    {/* Consent is not the same as having their address. Only a
                        ticked box permits marketing; everyone here may be sent
                        the list they actually asked for. */}
                    {r.consented_at ? (
                      <Badge variant="success" className="gap-1">
                        <BadgeCheck className="h-3 w-3" />
                        Marketing OK
                      </Badge>
                    ) : (
                      <Badge variant="outline">This list only</Badge>
                    )}
                    {r.delivered_at && <Badge variant="secondary">Sent</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {r.trade} · {r.city} · {r.results_found} result
                    {r.results_found === 1 ? "" : "s"}
                    {r.phone ? ` · ${r.phone}` : ""}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(r.created_at as string).toLocaleString(undefined, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
