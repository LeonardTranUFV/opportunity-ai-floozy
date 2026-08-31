import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stripe's side of the conversation: what the customer actually bought.
 *
 * Without this the money and the product never meet. /api/checkout attaches
 * the Supabase user id to the Stripe session; this reads it back and writes
 * the entitlement. Between the two, a payment becomes access.
 *
 * The signature check is the authentication. Stripe posts here from its own
 * servers, so there is no session to verify and the URL is public — anyone can
 * find it. The only thing separating a real Stripe event from someone
 * hand-rolling a POST that says "this user is now on the monthly plan" is that
 * HMAC, which is why it is verified before the body is parsed and why a
 * failure returns 400 without touching the database.
 *
 * Verified by hand rather than with the `stripe` package: this needs one HMAC
 * and a timestamp comparison, and adding a dependency to a serverless bundle
 * for that is a poor trade.
 *
 * Setup: Stripe Dashboard → Developers → Webhooks → add endpoint
 *   https://app.floozy.ca/api/webhooks/stripe
 * subscribed to checkout.session.completed, customer.subscription.updated and
 * customer.subscription.deleted. Then put its signing secret in Vercel as
 * STRIPE_WEBHOOK_SECRET.
 */

export const dynamic = "force-dynamic";

/**
 * How far out of step a timestamp may be. Stripe's own recommendation is five
 * minutes. It is what stops a captured request being replayed later — the
 * signature stays valid forever, the timestamp does not.
 */
const TOLERANCE_SECONDS = 300;

/** Price ids are not hardcoded; the plan is read from the product nickname. */
const PLAN_BY_INTERVAL: Record<string, string> = { week: "weekly", month: "monthly" };

interface StripeEvent {
  type?: string;
  data?: { object?: Record<string, unknown> };
}

/**
 * Constant-time compare. `===` on a signature leaks how many leading bytes
 * were right through timing, which is enough to forge one given patience.
 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verify(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;

  // t=1234567890,v1=abc...,v1=def...  — more than one v1 during key rotation.
  const parts = header.split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));

  if (!timestamp || !signatures.length) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  return signatures.some((candidate) => safeEqual(candidate, expected));
}

/** Reads the billing interval off whichever shape the event carries. */
function planFrom(subscription: Record<string, unknown>): string | null {
  const items = (subscription.items as { data?: Array<Record<string, unknown>> } | undefined)?.data;
  const price = items?.[0]?.price as { recurring?: { interval?: string } } | undefined;
  const interval = price?.recurring?.interval;
  return interval ? (PLAN_BY_INTERVAL[interval] ?? null) : null;
}

export async function POST(request: Request) {
  // @public-route — Stripe posts here from its own servers, so there is no
  // session to check. The HMAC signature below is the authentication, and it
  // runs before anything is parsed or written.
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Loud, because the failure mode is silent otherwise: Stripe keeps
    // delivering, we keep 500ing, and nobody's plan is ever written.
    console.error("[stripe] STRIPE_WEBHOOK_SECRET is not set — refusing to process events");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  // The raw text, not the parsed body. The signature covers the exact bytes
  // Stripe sent, so re-serialising a parsed object breaks verification over
  // key ordering and whitespace.
  const raw = await request.text();

  if (!verify(raw, request.headers.get("stripe-signature"), secret)) {
    console.warn("[stripe] rejected an event with a bad or stale signature");
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return NextResponse.json({ error: "Malformed event." }, { status: 400 });
  }

  const object = event.data?.object ?? {};
  const admin = createAdminClient();

  try {
    if (event.type === "checkout.session.completed") {
      // The one moment the Supabase user id is present. Every later event
      // arrives with Stripe ids only, which is why the row is created here.
      const userId = object.client_reference_id as string | null;
      if (!userId) {
        // Someone reached a payment link directly rather than through
        // /api/checkout. The payment is real but unattributable, so say so
        // loudly — this is a customer who paid and will not get access.
        console.error(
          `[stripe] checkout completed with no client_reference_id — session ${String(object.id)} cannot be linked to an account`
        );
        return NextResponse.json({ received: true, linked: false });
      }

      await admin.from("subscriptions").upsert(
        {
          user_id: userId,
          stripe_customer_id: (object.customer as string) ?? null,
          stripe_subscription_id: (object.subscription as string) ?? null,
          status: "trialing",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      console.log(`[stripe] linked subscription for user ${userId}`);
      return NextResponse.json({ received: true, linked: true });
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      // Keyed by Stripe's id, because this event never carries ours.
      const subscriptionId = object.id as string | undefined;
      if (!subscriptionId) return NextResponse.json({ received: true });

      const periodEnd = object.current_period_end as number | undefined;

      await admin
        .from("subscriptions")
        .update({
          status:
            event.type === "customer.subscription.deleted"
              ? "canceled"
              : ((object.status as string) ?? "unknown"),
          plan: planFrom(object),
          current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", subscriptionId);

      return NextResponse.json({ received: true });
    }

    // Everything else is acknowledged and ignored. Returning non-2xx would
    // make Stripe retry an event we were never going to act on.
    return NextResponse.json({ received: true, ignored: event.type ?? "unknown" });
  } catch (error) {
    // 500 so Stripe retries — a database blip should not silently cost someone
    // the access they paid for.
    console.error(
      `[stripe] failed handling ${event.type ?? "event"}:`,
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }
}
