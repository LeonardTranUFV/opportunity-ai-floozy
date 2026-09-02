import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";

/**
 * "Email me the rest" — the second way out of the free scan.
 *
 * A stranger who has just seen three real leads for their trade either creates
 * an account or leaves an address. This is the second door, and it exists
 * because the account is a bigger ask than the moment deserves: they have
 * known us for ninety seconds.
 *
 * The row it writes is two things at once — the delivery address for the leads
 * they asked for, and a prospect worth following up. Those are different
 * permissions, which is why consent is stored separately from the address
 * rather than inferred from having it. Someone who did not tick the box still
 * gets the scan they requested; they do not get marketing.
 */

export const dynamic = "force-dynamic";

interface Body {
  email?: unknown;
  phone?: unknown;
  trade?: unknown;
  city?: unknown;
  results?: unknown;
  consent?: unknown;
}

/**
 * Deliberately permissive. A stricter pattern rejects real addresses — new
 * TLDs, plus-addressing, apostrophes in a surname — and the cost of accepting
 * a malformed one is a bounced email, while the cost of rejecting a good one
 * is a lost customer standing at the door.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function callerIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: Request) {
  // @public-route — the whole point is that they do not have an account yet.
  // Guarded by the strict per-IP limit below; writes only to scan_requests,
  // which no user-facing query can read back.
  const rl = await rateLimit(
    `scan-capture:${callerIp(request)}`,
    LIMITS.strict.limit,
    LIMITS.strict.windowMs
  );
  if (!rl.allowed) return tooManyRequests(rl, "submissions");

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) {
    return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
  }

  const trade = typeof body.trade === "string" ? body.trade.trim().slice(0, 40) : "";
  const city = typeof body.city === "string" ? body.city.trim().slice(0, 60) : "";
  if (!trade || !city) {
    return NextResponse.json({ error: "Run a scan first." }, { status: 400 });
  }

  // Optional on purpose. A contractor gives an email to a site they met a
  // minute ago; a phone number they mostly do not, and requiring one trades a
  // large share of captures for a field we can ask for later.
  const phone =
    typeof body.phone === "string" && body.phone.trim()
      ? body.phone.trim().slice(0, 32)
      : null;

  const admin = createAdminClient();
  const { error } = await admin.from("scan_requests").upsert(
    {
      email,
      phone,
      trade,
      city,
      results_found: typeof body.results === "number" ? body.results : 0,
      // Recorded, never assumed. Having someone's address is not consent to
      // market to them, and CASL does not treat it as one.
      consented_at: body.consent === true ? new Date().toISOString() : null,
    },
    { onConflict: "email,trade,city" }
  );

  if (error) {
    const missing = /scan_requests/.test(error.message);
    console.error(`[scan] capture failed: ${error.message}`);
    return NextResponse.json(
      {
        error: missing
          ? "Not set up yet — migration 0014_scan_requests.sql has not been applied."
          : "Could not save that. Try again in a moment.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
