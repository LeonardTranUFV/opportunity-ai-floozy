"use client"

import { useTheme } from "next-themes"
import { Sun, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  // resolvedTheme is unknown on the server, so the icon can only be chosen
  // once we are in a browser. Render the disabled placeholder until then.
  const hydrated = useHydrated()

  if (!hydrated) {
    return <Button variant="ghost" size="icon" aria-label="Toggle theme" disabled />
  }

  const isDark = resolvedTheme === "dark"

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
