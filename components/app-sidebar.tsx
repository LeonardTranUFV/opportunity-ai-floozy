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
import { Home, Users, Briefcase, ListTodo, Settings, Compass, Wrench, KeyRound, LogOut, BookOpen, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

// Each section gets its own accent color — same rotation the dashboard stat
// cards already use (rose/blue/amber/emerald) — so the whole nav reads as
// colorful sections instead of one flat brand-blue highlight.
const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: Home, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10", dot: "before:bg-blue-500" },
  { href: "/opportunities", label: "Opportunities", icon: ListTodo, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/10", dot: "before:bg-rose-500" },
  { href: "/agents", label: "AI Agents", icon: Users, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10", dot: "before:bg-violet-500" },
  { href: "/communities", label: "Communities", icon: Compass, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", dot: "before:bg-emerald-500" },
  { href: "/accounts", label: "Connect Accounts", icon: KeyRound, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", dot: "before:bg-amber-500" },
  { href: "/crm", label: "CRM Pipeline", icon: Briefcase, color: "text-cyan-600 dark:text-cyan-400", bg: "bg-cyan-500/10", dot: "before:bg-cyan-500" },
  { href: "/guide", label: "How It Works", icon: BookOpen, color: "text-fuchsia-600 dark:text-fuchsia-400", bg: "bg-fuchsia-500/10", dot: "before:bg-fuchsia-500" },
  { href: "/tools", label: "Tools", icon: Wrench, color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/10", dot: "before:bg-orange-500" },
  { href: "/settings", label: "Settings", icon: Settings, color: "text-slate-600 dark:text-slate-400", bg: "bg-slate-500/10", dot: "before:bg-slate-500" },
]

export function AppSidebar({ userEmail, isAdmin }: { userEmail?: string; isAdmin?: boolean }) {
  const pathname = usePathname()
  const navItems = isAdmin
    ? [
        ...NAV_ITEMS,
        {
          href: "/admin",
          label: "Admin",
          icon: ShieldCheck,
          color: "text-indigo-600 dark:text-indigo-400",
          bg: "bg-indigo-500/10",
          dot: "before:bg-indigo-500",
        },
      ]
    : NAV_ITEMS

  return (
    <Sidebar variant="inset" collapsible="icon" style={{ "--sidebar-width": "17.5rem" } as React.CSSProperties}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 text-primary-foreground shadow-sm shadow-blue-600/30">
                <span className="font-bold text-white">O</span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Floozy Opportunity AI</span>
                <span className="truncate text-xs text-muted-foreground">Growth Engine</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
              {navItems.map(({ href, label, icon: Icon, color, bg, dot }) => {
                const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href)
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      size="lg"
                      tooltip={label}
                      isActive={isActive}
                      // data-tour anchors the product tour's spotlight to the
                      // real nav item, so the walkthrough points at the actual
                      // button rather than a mock of it.
                      render={<Link href={href} data-tour={`nav-${href === "/" ? "dashboard" : href.slice(1)}`} />}
                      className={cn(
                        "relative transition-colors",
                        isActive &&
                          cn(
                            bg,
                            dot,
                            "font-medium before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full"
                          )
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
                          isActive ? bg : "bg-transparent group-hover/menu-button:bg-muted"
                        )}
                      >
                        <Icon className={cn("size-4", isActive ? color : "text-muted-foreground")} />
                      </span>
                      <span className={cn("text-[0.925rem]", isActive && color)}>{label}</span>
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
