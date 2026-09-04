"use client"

import { usePathname } from "next/navigation"

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/opportunities": "Opportunities",
  "/agents": "AI Agents",
  "/agents/new": "Create Agent",
  "/communities": "Communities",
  "/accounts": "Connect Accounts",
  "/crm": "CRM Pipeline",
  "/tools": "Tools",
  "/settings": "Settings",
}

export function PageTitle() {
  const pathname = usePathname()
  const title = TITLES[pathname] ?? "Floozy Opportunity AI"
  // truncate + min-w-0: the header's right-hand cluster grew a plan badge, and
  // on a 375px screen "Connect Accounts" beside it has to give way, not wrap
  // onto a second line or shove the bell off the edge.
  return <h1 className="min-w-0 truncate font-semibold text-sm">{title}</h1>
}
