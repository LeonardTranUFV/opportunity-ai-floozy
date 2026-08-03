import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { PageTitle } from "@/components/page-title"
import { NotificationsBell } from "@/components/notifications-bell"
import { ThemeToggle } from "@/components/theme-toggle"
import { CreditBar } from "@/components/credit-bar"
import { createClient } from "@/lib/supabase/server"
import { isAdmin } from "@/lib/admin"
import { PLAN_ALLOWANCES } from "@/lib/credits"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userIsAdmin = user ? await isAdmin(supabase, user.id) : false

  let credits: { balance: number; allowance: number } | null = null
  if (user) {
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
      <AppSidebar userEmail={user?.email} isAdmin={userIsAdmin} />
      <div className="flex-1 w-full flex flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger />
          <div className="w-full flex justify-between items-center px-4">
            <PageTitle />
            <div className="flex items-center gap-1">
              {credits && <CreditBar balance={credits.balance} allowance={credits.allowance} />}
              <ThemeToggle />
              <NotificationsBell />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </SidebarProvider>
  )
}
