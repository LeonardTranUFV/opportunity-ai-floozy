import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";


/**
 * Where to send someone after the link in their email works.
 *
 * `next` arrives in the URL, so it is attacker-controlled, and it used to be
 * concatenated straight onto the origin. That is an open redirect: "@evil.com"
 * turns "https://app.floozy.ca" + next into "https://app.floozy.ca@evil.com",
 * where everything before the @ is userinfo and the actual host is evil.com.
 * Verified, not assumed — URL parsing resolves that host to evil.com.
 *
 * The cost is specific: this runs immediately after a successful sign-in, so a
 * phishing page reached this way is one the customer arrives at already
 * trusting, straight from a real email we sent.
 *
 * Only a path on this site is allowed. A leading "//" or "/\\" is rejected too,
 * since browsers read both as protocol-relative.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=link_expired`);
}
