"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, ListTodo, Users, Compass, Menu } from "lucide-react"
import { useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

/**
 * Bottom tab bar, phones only.
 *
 * On mobile the sidebar collapses into a sheet, so every single navigation
 * costs two taps (open sheet, pick item) plus a full-screen overlay. This app
 * is used one-handed between jobs, so the four screens that matter get a
 * permanent thumb-reachable bar; everything else stays behind the menu.
 *
 * Colours match each section's accent in the sidebar so the two navigations
 * teach the same visual language rather than competing.
 */
const TABS = [
  { href: "/", label: "Home", icon: Home, active: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/10" },
  { href: "/opportunities", label: "Leads", icon: ListTodo, active: "text-rose-600 dark:text-rose-400", bg: "bg-rose-500/10" },
  { href: "/agents", label: "Agents", icon: Users, active: "text-violet-600 dark:text-violet-400", bg: "bg-violet-500/10" },
  { href: "/communities", label: "Sources", icon: Compass, active: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10" },
]

export function MobileNav() {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border bg-background/95 backdrop-blur",
        "supports-[backdrop-filter]:bg-background/80 md:hidden",
        // Keeps the bar clear of the iOS home indicator.
        "pb-[env(safe-area-inset-bottom)]"
      )}
    >
      {TABS.map(({ href, label, icon: Icon, active, bg }) => {
        const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            // Same anchors the sidebar carries. Without these the guided tour
            // had nothing to point at on a phone: the sidebar is a closed
            // sheet there, so every "1 — Connect an account" step fell back to
            // a centred card after opening with "I'll point at each button as
            // we go".
            data-tour={`nav-${href === "/" ? "dashboard" : href.slice(1)}`}
            className="flex flex-1 flex-col items-center gap-1 py-2 text-[0.7rem] font-medium"
          >
            <span
              className={cn(
                "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                isActive ? bg : "bg-transparent"
              )}
            >
              <Icon className={cn("size-[18px]", isActive ? active : "text-muted-foreground")} />
            </span>
            <span className={cn(isActive ? active : "text-muted-foreground")}>{label}</span>
          </Link>
        )
      })}

      {/* Everything not on the bar — Settings, CRM, Tools, guide, admin. */}
      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        aria-label="Open menu"
        className="flex flex-1 flex-col items-center gap-1 py-2 text-[0.7rem] font-medium text-muted-foreground"
      >
        <span className="flex h-7 w-12 items-center justify-center rounded-full">
          <Menu className="size-[18px]" />
        </span>
        More
      </button>
    </nav>
  )
}
