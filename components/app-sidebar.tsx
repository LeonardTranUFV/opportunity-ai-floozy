"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Home, Users, Briefcase, ListTodo, Settings, Compass, Wrench, KeyRound, LogOut } from "lucide-react"

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/opportunities", label: "Opportunities", icon: ListTodo },
  { href: "/agents", label: "AI Agents", icon: Users },
  { href: "/communities", label: "Communities", icon: Compass },
  { href: "/accounts", label: "Connect Accounts", icon: KeyRound },
  { href: "/crm", label: "CRM Pipeline", icon: Briefcase },
  { href: "/tools", label: "Tools", icon: Wrench },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function AppSidebar({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname()

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 text-primary-foreground shadow-sm">
                <span className="font-bold text-white">O</span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Opportunity AI</span>
                <span className="truncate text-xs">Growth Engine</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href)
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      tooltip={label}
                      isActive={isActive}
                      render={<Link href={href} />}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {userEmail && (
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="truncate text-xs text-muted-foreground">{userEmail}</span>
                <form action="/auth/signout" method="post">
                  <button
                    type="submit"
                    aria-label="Sign out"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </form>
              </div>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
