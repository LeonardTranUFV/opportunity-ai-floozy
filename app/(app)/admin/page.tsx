import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { ShieldAlert, ShieldOff } from "lucide-react"
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
    </div>
  )
}
