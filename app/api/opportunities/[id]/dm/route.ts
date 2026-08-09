import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Direct messages are prepared here and sent by a person. Never by the server.
 *
 * This route used to call `sendFacebookMessage`, which drove a headless
 * Chromium session and delivered the DM itself. That made the software the
 * sender of an unsolicited commercial message to somebody who had never
 * asked to hear from us, which is the part that carries real exposure:
 *
 *   - CASL (we operate from Canada) governs commercial electronic messages
 *     sent to an *electronic address*. A Facebook DM is one. It requires
 *     consent before sending, plus sender identification and a working
 *     unsubscribe — a stranger's group post gives none of the three.
 *   - GDPR Art. 14 requires telling people when their data was collected from
 *     somewhere other than them. An automated DM is exactly the moment that
 *     obligation bites.
 *   - Meta's platform terms prohibit automating a logged-in session.
 *
 * A public comment is treated differently and still sends automatically: CASL
 * attaches to messages sent to an electronic address, and a comment published
 * on a public post is not sent to an address at all. See the comment route.
 *
 * POST  prepares the message and returns it. Nothing is transmitted.
 * PATCH records that the operator sent it, after they actually did.
 */

/** Best-effort Messenger deep link, so the operator lands in the right thread. */
function messengerUrl(profileUrl: string): string {
  try {
    const u = new URL(profileUrl);
    const numericId = u.searchParams.get("id");
    if (numericId) return `https://m.me/${numericId}`;
    const handle = u.pathname.split("/").filter(Boolean).pop();
    if (handle && !handle.includes(".")) return `https://m.me/${handle}`;
  } catch {
    // Fall through — an unparseable URL is still worth opening as-is.
  }
  return profileUrl;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: opportunityId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, platform, author_profile_url, suggested_dm")
    .eq("id", opportunityId)
    .single();

  if (oppError || !opportunity) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }
  if (!opportunity.author_profile_url) {
    return NextResponse.json(
      { success: false, error: "This opportunity has no linked profile URL." },
      { status: 400 }
    );
  }
  if (!opportunity.suggested_dm) {
    return NextResponse.json(
      { success: false, error: "Generate a personalized response first." },
      { status: 400 }
    );
  }

  // Prepared, not sent. `dm_sent_at` stays null until a person says otherwise.
  return NextResponse.json({
    success: true,
    message: opportunity.suggested_dm,
    profileUrl: opportunity.author_profile_url,
    openUrl: messengerUrl(opportunity.author_profile_url),
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: opportunityId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  // Recording what the operator did, not doing it for them.
  const { error } = await supabase
    .from("opportunities")
    .update({ dm_sent_at: new Date().toISOString() })
    .eq("id", opportunityId);

  if (error) {
    return NextResponse.json({ success: false, error: "Could not record that." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
