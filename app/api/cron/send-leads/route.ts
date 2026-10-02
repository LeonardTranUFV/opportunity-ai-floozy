import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDue } from "@/lib/lead-digest";
import { mailerConfigured } from "@/lib/mailer";
import { sendDigest, type RecipientRow, type SendResult } from "@/lib/send-digest";

/**
 * The morning lead email.
 *
 * Runs every hour and sends to whichever recipients have just reached their
 * own send hour. Hourly rather than once at 8am because "8 in the morning" is
 * a different instant for a client in Vancouver and one in Hanoi, and one cron
 * entry has to serve both.
 *
 * A second send is impossible: `last_sent_on` is a date in the recipient's own
 * timezone, written after a successful send and checked before one, so a
 * retry, a redeploy or two invocations in the same hour all find today's date
 * already there. `lead_deliveries` then stops any individual lead going out
 * twice even if the schedule changes.
 *
 * One recipient failing — a bounced address, a revoked app password — is
 * recorded against that row and the loop continues. One bad address must not
 * stop every other client's morning.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: "CRON_SECRET is not set" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  // ?dry=1 reports who would be sent to, and sends nothing.
  const dry = new URL(request.url).searchParams.get("dry") === "1";

  const admin = createAdminClient();
  const { data: recipients, error } = await admin
    .from("lead_recipients")
    .select("id,user_id,name,email,agent_ids,send_hour,timezone,last_sent_on")
    .eq("active", true);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const now = new Date();
  const due = ((recipients ?? []) as RecipientRow[]).filter((r) => isDue(r, now));

  if (due.length === 0) {
    return NextResponse.json({ success: true, considered: recipients?.length ?? 0, sent: 0, results: [] });
  }
  if (!dry && !mailerConfigured()) {
    return NextResponse.json(
      { success: false, error: "Mail is not configured — set GMAIL_USER and GMAIL_APP_PASSWORD." },
      { status: 500 }
    );
  }

  const results: SendResult[] = [];
  for (const r of due) {
    try {
      results.push(await sendDigest(admin, r, { dry, now }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "send failed";
      console.error(`[send-leads] ${r.name}: ${message}`);
      await admin
        .from("lead_recipients")
        .update({ last_result: `Failed: ${message}`.slice(0, 300), updated_at: new Date().toISOString() })
        .eq("id", r.id);
      results.push({ recipient: r.name, leads: 0, status: `failed: ${message}` });
    }
  }

  return NextResponse.json({
    success: true,
    considered: recipients?.length ?? 0,
    sent: results.filter((x) => x.status === "sent").length,
    results,
  });
}
