import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isExactPostUrl } from "@/lib/post-url";

/**
 * Comments are prepared here and published by a person. Never by the server.
 *
 * This route used to call `postFacebookComment`, which drove the customer's
 * own logged-in session and published the reply itself. The reasoning for
 * allowing that was narrow and, as far as it went, correct: CASL attaches to
 * commercial messages sent to an *electronic address*, and a comment on a
 * public post is not sent to an address at all. So the anti-spam argument that
 * forced the DM route to draft-only genuinely did not apply here.
 *
 * It was the wrong test, because two other things apply and neither is about
 * CASL:
 *
 *   - **Meta's platform terms prohibit automating a logged-in session.** This
 *     is the rule that actually gets enforced, and automated commenting is the
 *     single most detectable form of it. The account it bans is the customer's,
 *     not ours — we would be spending an asset that isn't ours to spend.
 *   - **It publishes in the customer's name, in public, without them reading
 *     it.** A drafted reply that misjudges the post is a mistake their whole
 *     audience can see, attached to their business, permanently.
 *
 * The first contact is now always a human decision — a person reads the post,
 * reads the draft, and chooses. What happens *after* the other person replies
 * is a different question with a different answer, because a reply is an
 * inquiry and answering one is exempt; that is where automation belongs, and
 * it is not this route.
 *
 * POST  prepares the comment and returns it. Nothing is published.
 * PATCH records that the operator posted it, after they actually did.
 */

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
    .select("id, platform, post_url, suggested_comment")
    .eq("id", opportunityId)
    .single();

  if (oppError || !opportunity) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }

  /**
   * A link to the group is not a link to the post.
   *
   * Less dangerous than it was — nothing is published now, so the worst case
   * is a wasted trip rather than a comment on a stranger's unrelated post —
   * but still not something to hand somebody as "reply to this". The
   * extractors fall back to the group's feed URL whenever no permalink was
   * found, and there is no way to tell from here which post was meant.
   */
  if (!isExactPostUrl(opportunity.post_url)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This platform didn't give us a direct link to that post, only to the group — so we can't point you at the right one. Open the group and reply there yourself.",
      },
      { status: 400 }
    );
  }

  if (!opportunity.suggested_comment) {
    return NextResponse.json(
      { success: false, error: "Generate a personalized response first." },
      { status: 400 }
    );
  }

  // Prepared, not published. `comment_sent_at` stays null until a person says
  // otherwise, through PATCH below.
  return NextResponse.json({
    success: true,
    message: opportunity.suggested_comment,
    openUrl: opportunity.post_url,
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

  // Recording what the operator did, not doing it for them. Scoped to the
  // caller's own rows by RLS, the same as the DM route.
  const { error } = await supabase
    .from("opportunities")
    .update({ comment_sent_at: new Date().toISOString() })
    .eq("id", opportunityId);

  if (error) {
    return NextResponse.json({ success: false, error: "Could not record that." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
