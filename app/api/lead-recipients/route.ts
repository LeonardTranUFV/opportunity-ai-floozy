import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";
import { validateRecipient } from "@/lib/recipient-input";

/** Who gets the morning leads. One row per client. */

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("lead_recipients")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recipients: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(`recipients-write:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "changes");

  const body = await request.json().catch(() => ({}));
  const parsed = await validateRecipient(supabase, user.id, body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await supabase
    .from("lead_recipients")
    .insert({ user_id: user.id, ...parsed.value })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ recipient: data });
}
