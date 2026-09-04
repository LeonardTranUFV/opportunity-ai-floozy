import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { postFacebookComment } from "@/lib/facebook-outreach";
import { canRunSignedInBrowser } from "@/lib/remote-browser";
import { isExactPostUrl } from "@/lib/post-url";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: opportunityId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  // Posts publicly to Facebook through the customer's own logged-in session.
  // The cost of no limit is not money, it is their account: a loop here is
  // indistinguishable from comment spam, and Facebook bans the account doing
  // it, not us.
  const rl = await rateLimit(`comment:${user.id}`, LIMITS.browser.limit, LIMITS.browser.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "comments");

  // postFacebookComment already goes through openPlatformContext, so it works
  // wherever a signed-in browser can be opened — including a rented one. This
  // gate said "hosted", which stopped being the same question the moment the
  // cloud path shipped: sending a comment was refused on the only deployment
  // customers actually use, while the code behind it was fine.
  if (!canRunSignedInBrowser()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Sending a comment needs a signed-in browser, and none is set up on this deployment.",
      },
      { status: 501 }
    );
  }

  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, platform, post_url, suggested_comment")
    .eq("id", opportunityId)
    .single();

  if (oppError || !opportunity) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }

  if (opportunity.platform !== "facebook") {
    return NextResponse.json(
      { success: false, error: "Automated comments are only supported for Facebook right now." },
      { status: 400 }
    );
  }

  /**
   * A link to the group is not a link to the post.
   *
   * When Facebook doesn't expose a permalink the extractors fall back to the
   * group's feed URL, and this check only asked whether *some* URL existed. So
   * the automation would open the group's front page and comment there —
   * publishing the customer's drafted reply, in their name, on whatever post
   * happened to be at the top, or on nothing at all.
   *
   * That is the worst class of bug in this product: a public action, taken on
   * a real person's behalf, in the wrong place. Refused outright rather than
   * attempted, and the UI disables the button for the same reason.
   */
  if (!isExactPostUrl(opportunity.post_url)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This platform didn't give us a direct link to that post, only to the group — so we can't be sure a comment would land on the right one. Open the group and reply there yourself.",
      },
      { status: 400 }
    );
  }

  if (!opportunity.post_url) {
    return NextResponse.json({ success: false, error: "This opportunity has no linked post URL." }, { status: 400 });
  }

  if (!opportunity.suggested_comment) {
    return NextResponse.json(
      { success: false, error: "Generate a personalized response first, then send it." },
      { status: 400 }
    );
  }

  const result = await postFacebookComment(opportunity.post_url, opportunity.suggested_comment, user.id);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 });
  }

  await supabase.from("opportunities").update({ comment_sent_at: new Date().toISOString() }).eq("id", opportunityId);

  return NextResponse.json({ success: true });
}
