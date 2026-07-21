import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { CheckCircle2, XCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { SettingsForm } from "@/components/settings/settings-form"

export const dynamic = "force-dynamic"

function maskKey(key: string | undefined): string {
  if (!key) return "Not configured"
  if (key.length <= 8) return "••••••••"
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: rows } = await supabase.from("settings").select("key, value")
  const settingsMap = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]))

  const integrations = [
    { name: "Gemini API (AI reasoning)", key: process.env.GEMINI_API_KEY },
    { name: "GoHighLevel (CRM dispatch)", key: process.env.GHL_API_KEY },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Configure how the AI reasons about opportunities and check your integrations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI Persona</CardTitle>
          <CardDescription>
            Default reasoning settings used across the platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm
            initialGoal={settingsMap.ai_goal || "home_services"}
            initialLanguages={settingsMap.ai_languages || "English"}
            initialCustomRules={settingsMap.ai_custom_rules || ""}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>API keys are read from your .env file — never edited here.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {integrations.map((integration) => (
            <div key={integration.name} className="flex items-center justify-between text-sm">
              <span>{integration.name}</span>
              <span className="flex items-center gap-2 text-muted-foreground">
                {integration.key ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <code className="text-xs">{maskKey(integration.key)}</code>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Agents</CardTitle>
          <CardDescription>
            Each agent has its own goal, location, and keywords — manage them from the{" "}
            <a href="/agents" className="underline">
              AI Agents
            </a>{" "}
            page.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
