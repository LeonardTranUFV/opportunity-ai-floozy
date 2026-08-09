import { createClient } from "@/lib/supabase/server";

export const PRIVACY_MODE_KEY = "privacy_mode";

/**
 * Privacy mode hides the identity of the people behind your leads — names
 * become initials, profile links disappear, phone numbers are partly masked.
 *
 * It exists for recording. Every lead in this app is a real person's real post,
 * so a screen recording or a shared screenshot publishes their name to an
 * audience that has nothing to do with them. Blurring afterwards in a video
 * editor is slow and easy to get wrong — one un-blurred frame is enough — so
 * the app can simply not render the name in the first place.
 *
 * It changes display only. The underlying data is untouched, so turning it off
 * brings every name straight back, and outreach still goes to the right person.
 */
export async function isPrivacyMode(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<boolean> {
  // No user_id filter: RLS already scopes `settings` to the caller, which is
  // the same pattern the other per-user setting reads use.
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", PRIVACY_MODE_KEY)
    .maybeSingle();
  return data?.value === "on";
}

/**
 * Initials rather than a flat "Anonymous" for every row: a list of ten
 * identical placeholders reads as fake data and undercuts the demo, while
 * initials keep the rows visually distinct and still identify nobody.
 */
export function maskName(name: string | null | undefined, enabled: boolean): string {
  if (!enabled) return name ?? "";
  if (!name) return "Member";

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.match(/\p{L}/u)?.[0])
    .filter(Boolean)
    .slice(0, 2)
    .join(".");

  return initials ? `${initials}.` : "Member";
}

/** Keeps the last two digits so the row still reads as a real phone number. */
export function maskPhone(phone: string | null | undefined, enabled: boolean): string | null {
  if (!phone) return phone ?? null;
  if (!enabled) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "•••-••••";
  return `•••-•••-••${digits.slice(-2)}`;
}
