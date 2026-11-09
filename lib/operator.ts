import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminIdentity } from "@/lib/privileges";
import { sendMail, mailerConfigured } from "@/lib/mailer";
import { siteUrl } from "@/lib/site-url";
import type { RequestInput } from "@/lib/group-requests";

/** The signed-in operator, or null. An operator inside a client's account is that client here. */
export async function currentOperator(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user && isAdminIdentity(user.id, user.email) ? user : null;
}

/**
 * Whose login a cloud-browser session belongs to: the caller's own, or, for an
 * operator naming a Floozy Facebook account, that account's. Null means refused.
 */
export async function connectOwner(user: User, collectorId: unknown): Promise<string | null> {
  if (collectorId === undefined || collectorId === null) return user.id;
  if (typeof collectorId !== "string" || !isAdminIdentity(user.id, user.email)) return null;
  const { data } = await createAdminClient()
    .from("floozy_collectors")
    .select("user_id")
    .eq("user_id", collectorId)
    .eq("active", true)
    .maybeSingle();
  return data ? collectorId : null;
}

export async function countOpenGroupRequests(): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("group_requests")
    .select("id", { count: "exact", head: true })
    .in("status", ["requested", "joining"]);
  return error ? 0 : count ?? 0;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Tells Floozy a client asked for a group. A mail failure must not lose the request. */
export async function announceGroupRequest(clientLabel: string, input: RequestInput): Promise<void> {
  const recipients = (process.env.ADMIN_EMAILS ?? "").split(/[,\s]+/).filter(Boolean);
  if (recipients.length === 0 || !mailerConfigured()) return;
  const link = new URL("/admin/facebook", siteUrl()).toString();
  const html =
    `<p><strong>${escapeHtml(clientLabel)}</strong> asked Floozy to watch a Facebook group.</p>` +
    `<p>Group: <a href="${escapeHtml(input.url)}">${escapeHtml(input.name ?? input.url)}</a></p>` +
    (input.note ? `<p>Their note: ${escapeHtml(input.note)}</p>` : "") +
    `<p><a href="${escapeHtml(link)}">Open the request queue</a></p>`;
  await Promise.all(
    recipients.map((to) =>
      sendMail({ to, subject: `Group request from ${clientLabel.replace(/[\r\n]+/g, " ")}`, html }).catch((err) =>
        console.error("[group-requests] could not email the alert:", err instanceof Error ? err.message : err)
      )
    )
  );
}
