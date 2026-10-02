import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Validating a recipient, in one place, because the create and the edit route
 * must agree. The database has the same two rules as constraints (an hour in
 * range, a destination present); these exist so a mistake comes back as a
 * sentence rather than a Postgres error code.
 */

export interface RecipientInput {
  name: string;
  email: string | null;
  phone: string | null;
  agent_ids: string[];
  send_hour: number;
  timezone: string;
  active: boolean;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function validateRecipient(
  supabase: SupabaseClient,
  userId: string,
  body: Record<string, unknown>
): Promise<{ value: RecipientInput } | { error: string }> {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "Give this client a name." };
  if (name.length > 120) return { error: "That name is too long." };

  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
  const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
  if (!email && !phone) return { error: "Add an email address or a phone number." };
  if (email && !EMAIL.test(email)) return { error: `"${email}" doesn't look like an email address.` };

  const hourRaw = body.send_hour;
  const send_hour = typeof hourRaw === "number" ? hourRaw : Number(hourRaw);
  if (!Number.isInteger(send_hour) || send_hour < 0 || send_hour > 23) {
    return { error: "Pick a send time between 0 and 23." };
  }

  const timezone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : "America/Vancouver";
  if (!validTimezone(timezone)) return { error: `"${timezone}" isn't a timezone I recognise.` };

  const agent_ids = Array.isArray(body.agent_ids) ? body.agent_ids.filter((a): a is string => typeof a === "string") : [];
  if (agent_ids.length > 0) {
    // Checked rather than trusted: the digest runs with the service role, so
    // an id from another account would otherwise send that account's leads.
    const { data: owned } = await supabase.from("agents").select("id").eq("user_id", userId).in("id", agent_ids);
    const ownedIds = new Set((owned ?? []).map((a) => a.id as string));
    const stranger = agent_ids.find((id) => !ownedIds.has(id));
    if (stranger) return { error: "One of those agents isn't on your account." };
  }

  return {
    value: {
      name,
      email,
      phone,
      agent_ids,
      send_hour,
      timezone,
      active: body.active === undefined ? true : Boolean(body.active),
    },
  };
}
