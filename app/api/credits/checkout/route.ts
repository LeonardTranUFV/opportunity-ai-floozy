import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlan } from "@/lib/entitlement";
import { isPackSize, packQuote, packsEnabled, PACK_CURRENCY } from "@/lib/credit-packs";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site-url";

/**
 * Sells a credit pack: opens a one-off Stripe Checkout for N credits.
 *
 * Plans go through payment links (see /api/checkout); packs cannot, because a
 * pack's price depends on the customer's plan and its quantity is theirs to
 * choose, and a payment link fixes both. So this creates a Checkout Session
 * directly, with the price built inline — no product or price has to exist in
 * the Stripe dashboard, and changing a pack rate is one constant in
 * lib/credit-packs.ts.
 *
 * Talks to Stripe over its REST API with fetch rather than the `stripe`
 * package, for the same reason the webhook verifies its own signature: one
 * form-encoded POST does not justify a dependency in a serverless bundle.
 *
 * What the session carries, and why:
 *   client_reference_id — the Supabase user id, the join key the webhook
 *     needs to know whose balance to credit.
 *   metadata.credits    — the quantity, so the webhook grants exactly what
 *     was paid for without re-deriving it from the amount.
 *   mode=payment        — one-off. The webhook branches on this so a pack
 *     never writes a subscription row.
 *
 * The secret key is the switch. Without it there is nothing to call, so the
 * plan page says packs aren't on yet and this route answers 503 — never a
 * crash, and never a button that leads nowhere.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!packsEnabled()) {
    return NextResponse.json(
      { error: "Credit packs aren't switched on for this deployment yet." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rl = await rateLimit(`credits-checkout:${user.id}`, LIMITS.strict.limit, LIMITS.strict.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "checkouts");

  let credits: unknown;
  try {
    ({ credits } = await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  if (!isPackSize(credits)) {
    return NextResponse.json({ error: "Pick one of the offered pack sizes." }, { status: 400 });
  }

  const plan = await getPlan(supabase, user.id);
  const quote = packQuote(plan, credits);

  // Stripe's API is form-encoded, with bracket notation for nested fields.
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("client_reference_id", user.id);
  if (user.email) params.set("customer_email", user.email);
  params.set("metadata[credits]", String(quote.credits));
  params.set("metadata[user_id]", user.id);
  params.set("metadata[plan]", plan);
  params.set("line_items[0][quantity]", String(quote.credits));
  params.set("line_items[0][price_data][currency]", PACK_CURRENCY);
  params.set("line_items[0][price_data][unit_amount]", String(quote.centsPerCredit));
  params.set("line_items[0][price_data][product_data][name]", "Opportunity AI credits");
  params.set(
    "line_items[0][price_data][product_data][description]",
    `${quote.credits} credits — scans, drafts and group discovery. Added to your account as soon as payment clears.`
  );
  params.set("success_url", `${siteUrl()}/billing?purchased=${quote.credits}`);
  params.set("cancel_url", `${siteUrl()}/billing`);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // Stripe attaches the session to this key so a retried click doesn't
      // open two checkouts for one intent.
      "Idempotency-Key": `pack:${user.id}:${quote.credits}:${Math.floor(Date.now() / 60_000)}`,
    },
    body: params.toString(),
  });

  const session = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
  if (!res.ok || !session.url) {
    // Stripe's message is for the log, not the customer — it names keys,
    // modes and parameters that mean nothing on a phone.
    console.error("[stripe] checkout session failed:", session.error?.message ?? res.status);
    return NextResponse.json(
      { error: "Couldn't start checkout right now. Try again in a minute." },
      { status: 502 }
    );
  }

  return NextResponse.json({ url: session.url });
}
