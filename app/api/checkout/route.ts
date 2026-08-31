import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";

/**
 * The only way to reach Stripe checkout.
 *
 * Linking a payment to an account is the entire reason this route exists. A
 * bare payment link takes money and tells us nothing: Stripe records a
 * customer by email, the app records a user by id, and nothing joins them. So
 * a contractor could pay, be charged on day four, and still be sitting on a
 * free account — with no way for us to notice from inside the product.
 *
 * Sending them through here instead attaches two things Stripe hands back on
 * the webhook:
 *
 *   client_reference_id — the Supabase user id. The join key. Without it the
 *     webhook can only guess by email, which breaks the moment someone pays
 *     with a different address from the one they signed up with — and trades
 *     routinely have a personal email and a business one.
 *   prefilled_email — one less field to type on a phone, and it keeps the
 *     Stripe customer aligned with the account by default.
 *
 * Anyone not signed in is sent to sign up first and returned here afterwards.
 * That ordering is deliberate: an account with no payment is recoverable, a
 * payment with no account is a support ticket and a refund.
 */

/** Live payment links. Both carry the 3-day trial; see app/pricing/page.tsx. */
const PLANS: Record<string, string> = {
  weekly: "https://buy.stripe.com/6oUbITfDv1Tr5eC2bM5wI0i",
  monthly: "https://buy.stripe.com/fZudR1gHzfKh0Ym4jU5wI0j",
};

export async function GET(request: Request) {
  const plan = new URL(request.url).searchParams.get("plan") ?? "";
  const target = PLANS[plan];

  if (!target) {
    return NextResponse.redirect(new URL("/pricing", siteUrl()));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Come back here once they have an account, so the click that started
    // checkout still ends at checkout.
    const signup = new URL("/signup", siteUrl());
    signup.searchParams.set("next", `/api/checkout?plan=${plan}`);
    return NextResponse.redirect(signup);
  }

  const checkout = new URL(target);
  checkout.searchParams.set("client_reference_id", user.id);
  if (user.email) checkout.searchParams.set("prefilled_email", user.email);

  // 303: this was a GET that results in going somewhere else, and 303 keeps
  // browsers from re-issuing anything odd if the user navigates back.
  return NextResponse.redirect(checkout, 303);
}
