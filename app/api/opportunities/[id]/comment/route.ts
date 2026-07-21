import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { postFacebookComment } from "@/lib/facebook-outreach";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: opportunityId } = await params;
  const supabase = await createClient();

  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, platform, post_url, suggested_reply")
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

  if (!opportunity.suggested_reply) {
    return NextResponse.json(
      { success: false, error: "Generate an AI reply first, then send it." },
      { status: 400 }
    );
  }

  const result = await postFacebookComment(opportunity.post_url, opportunity.suggested_reply);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 });
  }

  await supabase.from("opportunities").update({ comment_sent_at: new Date().toISOString() }).eq("id", opportunityId);

  return NextResponse.json({ success: true });
}
