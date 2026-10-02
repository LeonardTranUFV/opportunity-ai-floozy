import type { SupabaseClient } from "@supabase/supabase-js";
import { collectLeads, toCsv, emailHtml, countBuckets, localParts } from "@/lib/lead-digest";
import { sendMail } from "@/lib/mailer";

/**
 * Send one recipient their digest.
 *
 * Shared by the hourly cron and the "Send now" button, so a test send is
 * exactly what the morning will do — including writing `lead_deliveries`, so
 * pressing the button does not cause tomorrow to repeat what it just sent.
 *
 * Always takes a service-role client: it writes `lead_deliveries`, which has
 * no insert policy, and reads opportunities on behalf of the owner rather
 * than the caller.
 */

export interface RecipientRow {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  agent_ids: string[];
  send_hour: number;
  timezone: string;
  last_sent_on: string | null;
}

export interface SendResult {
  recipient: string;
  leads: number;
  status: "sent" | "no new leads" | "would send" | "skipped: no email" | string;
}

export async function sendDigest(
  admin: SupabaseClient,
  r: RecipientRow,
  opts: { dry?: boolean; now?: Date } = {}
): Promise<SendResult> {
  const now = opts.now ?? new Date();
  const { date: today } = localParts(r.timezone, now);

  const { data: already } = await admin
    .from("lead_deliveries")
    .select("opportunity_id")
    .eq("recipient_id", r.id);
  const alreadySent = new Set((already ?? []).map((d) => d.opportunity_id as string));

  const leads = await collectLeads(admin, {
    userId: r.user_id,
    agentIds: r.agent_ids ?? [],
    alreadySent,
    now: now.getTime(),
  });

  if (leads.length === 0) {
    // Stamped even with nothing to send: "nothing new today" is a complete
    // answer for today, and without it this recipient is reconsidered every
    // hour until midnight and the query re-runs each time.
    if (!opts.dry) await stamp(admin, r.id, { last_sent_on: today, last_result: "No new leads" });
    return { recipient: r.name, leads: 0, status: "no new leads" };
  }

  if (opts.dry) return { recipient: r.name, leads: leads.length, status: "would send" };

  if (!r.email) {
    // Phone-only. SMS is not built, so say so rather than quietly marking the
    // morning done and leaving the client wondering.
    await stamp(admin, r.id, { last_result: "No email address — SMS delivery is not available yet" });
    return { recipient: r.name, leads: leads.length, status: "skipped: no email" };
  }

  await sendMail({
    to: r.email,
    subject: `${leads.length} new lead${leads.length === 1 ? "" : "s"} for ${r.name} — ${today}`,
    html: emailHtml(r.name, leads),
    attachments: [
      { filename: `leads-${today}.csv`, content: toCsv(leads), contentType: "text/csv; charset=utf-8" },
    ],
  });

  // Written only after the send succeeded. A lead marked delivered that never
  // arrived is the one failure nobody can recover from.
  await admin.from("lead_deliveries").upsert(
    leads.map((l) => ({ recipient_id: r.id, opportunity_id: l.id })),
    { onConflict: "recipient_id,opportunity_id", ignoreDuplicates: true }
  );
  await stamp(admin, r.id, {
    last_sent_on: today,
    last_result: `Sent ${leads.length} (${countBuckets(leads)})`,
  });

  return { recipient: r.name, leads: leads.length, status: "sent" };
}

async function stamp(
  admin: SupabaseClient,
  id: string,
  fields: { last_sent_on?: string; last_result: string }
): Promise<void> {
  await admin
    .from("lead_recipients")
    .update({ ...fields, last_result: fields.last_result.slice(0, 300), updated_at: new Date().toISOString() })
    .eq("id", id);
}
