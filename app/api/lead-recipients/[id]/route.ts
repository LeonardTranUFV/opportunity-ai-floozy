import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";
import { validateRecipient } from "@/lib/recipient-input";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(`recipients-write:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "changes");

  const body = await request.json().catch(() => ({}));

  // Pausing is a one-field update and must not require re-sending the whole
  // row — the toggle in the list sends only { active }.
  if (Object.keys(body).length === 1 && "active" in body) {
    const { error } = await supabase
      .from("lead_recipients")
      .update({ active: Boolean(body.active), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  const parsed = await validateRecipient(supabase, user.id, body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await supabase
    .from("lead_recipients")
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recipient: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { error } = await supabase.from("lead_recipients").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
