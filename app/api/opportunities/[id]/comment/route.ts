import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { postFacebookComment } from "@/lib/facebook-outreach";
import { isHostedDeployment, BROWSER_UNAVAILABLE } from "@/lib/deployment";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: opportunityId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  if (isHostedDeployment()) {
    return NextResponse.json({ success: false, error: BROWSER_UNAVAILABLE }, { status: 501 });
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
