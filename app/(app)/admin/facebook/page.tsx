import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { ShieldAlert, ShieldOff } from "lucide-react"
import { createAdminClient } from "@/lib/supabase/admin"
import { currentOperator } from "@/lib/operator"
import { canConnectRemotely } from "@/lib/remote-browser"
import { SERVICE_AREAS } from "@/lib/service-areas"
import { accountLabel } from "@/lib/account-switch"
import type { GroupRequestStatus } from "@/lib/group-requests"
import { FacebookAccountsAdmin, type AdminCollector, type AdminRequest } from "@/components/admin/facebook-accounts-admin"

export const dynamic = "force-dynamic"

export default async function FacebookAccountsPage() {
  if (!(await currentOperator())) {
    return (
      <Card>
        <CardContent className="py-6">
          <EmptyState icon={ShieldOff} title="Not authorized" description="This page is restricted to Floozy admins." />
        </CardContent>
      </Card>
    )
  }

  const admin = createAdminClient()
  const [{ data: collectorRows, error: collectorError }, { data: requestRows, error: requestError }] = await Promise.all([
    admin.from("floozy_collectors").select("user_id, label").eq("active", true).order("created_at"),
    admin
      .from("group_requests")
      .select("id, user_id, url, name, note, status, collector_id, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ])

  if (collectorError || requestError) {
    return (
      <Card>
        <CardContent className="py-6">
          <EmptyState
            icon={ShieldAlert}
            title="One database update is missing"
            description="Run supabase/migrations/0025_collectors_and_group_requests.sql in the Supabase SQL editor."
          />
        </CardContent>
      </Card>
    )
  }

  const collectorIds = (collectorRows ?? []).map((c) => c.user_id as string)
  const clientIds = [...new Set((requestRows ?? []).map((r) => r.user_id as string))]

  const [{ data: sessions }, { data: groups }, { data: users }, { data: profiles }, { data: clientAreas }] = await Promise.all([
    // Named columns only: this table also holds the encrypted logins.
    admin.from("browser_sessions").select("user_id, status, last_verified_at").eq("platform", "facebook").in("user_id", collectorIds),
    admin.from("groups").select("user_id").eq("owner_kind", "floozy").eq("active", true).in("user_id", collectorIds),
    admin.auth.admin.listUsers({ perPage: 200 }),
    admin.from("company_profiles").select("user_id, business_name").in("user_id", clientIds),
    admin.from("client_service_areas").select("user_id, area_id").in("user_id", clientIds),
  ])

  const sessionBy = new Map((sessions ?? []).map((s) => [s.user_id as string, s]))
  const groupCount = new Map<string, number>()
  for (const g of groups ?? []) groupCount.set(g.user_id, (groupCount.get(g.user_id) ?? 0) + 1)
  const emailBy = new Map((users?.users ?? []).map((u) => [u.id, u.email ?? ""]))
  const nameBy = new Map((profiles ?? []).map((p) => [p.user_id as string, p.business_name as string | null]))
  const areaBy = new Map((clientAreas ?? []).map((a) => [a.user_id as string, a.area_id as string]))

  const collectors: AdminCollector[] = (collectorRows ?? []).map((c) => {
    const session = sessionBy.get(c.user_id)
    return {
      id: c.user_id,
      label: c.label,
      login: (session?.status as AdminCollector["login"]) ?? "none",
      lastVerifiedAt: session?.last_verified_at ?? null,
      groups: groupCount.get(c.user_id) ?? 0,
    }
  })

  const requests: AdminRequest[] = (requestRows ?? []).map((r) => {
    const email = emailBy.get(r.user_id) ?? ""
    return {
      id: r.id,
      url: r.url,
      name: r.name,
      note: r.note,
      status: r.status as GroupRequestStatus,
      collectorId: r.collector_id,
      client: accountLabel(email || "Unknown client", nameBy.get(r.user_id)),
      clientEmail: email,
      clientAreaId: areaBy.get(r.user_id) ?? null,
      createdAt: r.created_at,
    }
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-bold tracking-tight">Facebook Accounts</h2>
        <p className="text-muted-foreground">Floozy&apos;s own accounts, and the groups clients have asked you to join.</p>
      </div>
      <FacebookAccountsAdmin
        collectors={collectors}
        requests={requests}
        areas={SERVICE_AREAS.map((a) => ({ value: a.id, label: a.name }))}
        canConnect={canConnectRemotely()}
      />
    </div>
  )
}
