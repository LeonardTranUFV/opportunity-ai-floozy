import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { EditAgentForm } from "@/components/agents/edit-agent-form"

export const dynamic = "force-dynamic"

export default async function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) notFound()

  // RLS already scopes this to the owner; the explicit filter means somebody
  // else's id returns "not found" rather than an empty form.
  const { data: agent } = await supabase
    .from("agents")
    .select("id, name, goal, location, keywords, negative_keywords")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!agent) notFound()

  return (
    <div className="mx-auto w-full max-w-2xl">
      <EditAgentForm agent={agent} />
    </div>
  )
}
