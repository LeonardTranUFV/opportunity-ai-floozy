import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";
import { mailerConfigured } from "@/lib/mailer";
import { sendDigest, type RecipientRow } from "@/lib/send-digest";

/**
 * "Send now", and "preview" — the same code path the 8am cron takes, so what
 * a test send does is what the morning will do.
 *
 * Ownership is checked with the caller's own client before the service role is
 * used for the send itself. The digest has to read opportunities and write
 * `lead_deliveries`, neither of which the browser's key may do; the row is
 * fetched under RLS first precisely so that elevation is scoped to a recipient
 * the caller actually owns.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(`recipient-send:${user.id}`, LIMITS.strict.limit, LIMITS.strict.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "sends");

  const dry = new URL(request.url).searchParams.get("dry") === "1";

  const { data: recipient, error } = await supabase
    .from("lead_recipients")
    .select("id,user_id,name,email,agent_ids,send_hour,timezone,last_sent_on")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!recipient) return NextResponse.json({ error: "No such recipient." }, { status: 404 });

  if (!dry && !mailerConfigured()) {
    return NextResponse.json(
      { error: "Email isn't switched on for this deployment yet — GMAIL_USER and GMAIL_APP_PASSWORD are not set." },
      { status: 503 }
    );
  }

  try {
    const result = await sendDigest(createAdminClient(), recipient as RecipientRow, { dry });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed.";
    console.error(`[send-now] ${recipient.name}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
