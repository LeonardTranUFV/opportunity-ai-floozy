"use client"

import { usePathname } from "next/navigation"

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/opportunities": "Opportunities",
  "/agents": "AI Agents",
  "/agents/new": "Create Agent",
  "/crm": "CRM Pipeline",
  "/settings": "Settings",
}

export function PageTitle() {
  const pathname = usePathname()
  const title = TITLES[pathname] ?? "Opportunity AI"
  return <h1 className="font-semibold text-sm">{title}</h1>
}
