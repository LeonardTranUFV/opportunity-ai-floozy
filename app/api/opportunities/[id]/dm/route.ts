import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendFacebookMessage } from "@/lib/facebook-outreach";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: opportunityId } = await params;
  const supabase = await createClient();

  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, platform, author_profile_url, suggested_dm")
    .eq("id", opportunityId)
    .single();

  if (oppError || !opportunity) {
    return NextResponse.json({ success: false, error: "Opportunity not found" }, { status: 404 });
  }

  if (opportunity.platform !== "facebook") {
    return NextResponse.json(
      { success: false, error: "Automated DMs are only supported for Facebook right now." },
      { status: 400 }
    );
  }

  if (!opportunity.author_profile_url) {
    return NextResponse.json(
      { success: false, error: "This opportunity has no linked profile URL." },
      { status: 400 }
    );
  }

  if (!opportunity.suggested_dm) {
    return NextResponse.json(
      { success: false, error: "Generate a personalized response first, then send it." },
      { status: 400 }
    );
  }

  const result = await sendFacebookMessage(opportunity.author_profile_url, opportunity.suggested_dm);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 502 });
  }

  await supabase.from("opportunities").update({ dm_sent_at: new Date().toISOString() }).eq("id", opportunityId);

  return NextResponse.json({ success: true });
}
