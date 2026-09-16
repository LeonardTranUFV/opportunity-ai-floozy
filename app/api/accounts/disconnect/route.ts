import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeSession, isSessionPlatform, SESSION_PLATFORMS } from "@/lib/session-store";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";

/**
 * Disconnect a platform — delete the stored login, stop crawling as them.
 *
 * `revokeSession` has existed since sessions were first stored and nothing
 * ever called it. The only way to stop the crawler using an account was to
 * connect a different one over the top, which is not a thing a customer would
 * think of and not a thing they should have to do: a person who wants their
 * Facebook credentials out of somebody else's database should be able to say
 * so and have it be true within the second.
 *
 * It matters more than tidiness. When a platform serves "we suspect automated
 * behaviour", the first thing anyone sensible wants is a switch that stops the
 * automation immediately, before working out what to change. Without this the
 * only such switch was pausing every source by hand.
 *
 * The write overwrites the ciphertext rather than flagging the row — see
 * revokeSession. "Disconnect" has to mean the cookies are gone, not merely
 * ignored, or the promise on the connect screen is not true.
 *
 * Sources are deliberately left alone. They are the customer's list of which
 * communities to watch, which survives a reconnect and is tedious to rebuild;
 * they simply collect nothing while no session backs them. openPlatformContext
 * returns null for a platform with no stored session, and the crawl names the
 * customer as skipped rather than failing.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const rl = await rateLimit(`accounts-disconnect:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "requests");

  let platform: unknown;
  try {
    const body = (await request.json()) as { platform?: unknown };
    platform = body.platform;
  } catch {
    return NextResponse.json({ success: false, error: "Expected a JSON body" }, { status: 400 });
  }

  // Checked against the known list rather than passed through: this value
  // reaches a WHERE clause, and a typo would silently revoke nothing while
  // reporting success — the worst possible answer for a disconnect button.
  if (typeof platform !== "string" || !isSessionPlatform(platform)) {
    return NextResponse.json(
      { success: false, error: `platform must be one of: ${SESSION_PLATFORMS.join(", ")}` },
      { status: 400 }
    );
  }

  await revokeSession(user.id, platform);

  return NextResponse.json({
    success: true,
    platform,
    message: `${platform} disconnected. Its stored login has been deleted; your sources are untouched and will collect again once you reconnect.`,
  });
}
