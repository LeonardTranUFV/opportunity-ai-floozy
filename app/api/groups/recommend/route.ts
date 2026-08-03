import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recommendGroupsToJoin, type BusinessProfile } from "@/lib/ai";
import { spendCredits, CREDIT_COSTS, InsufficientCreditsError } from "@/lib/credits";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const trade = typeof body.trade === "string" ? body.trade.trim() : "";
  const location = typeof body.location === "string" ? body.location.trim() : "";
  if (!trade || !location) {
    return NextResponse.json({ error: "Tell us your trade and your main location first." }, { status: 400 });
  }

  const { data: settingsRows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["business_name", "business_pitch"]);
  const settingsMap = Object.fromEntries((settingsRows ?? []).map((r) => [r.key, r.value]));
  const businessProfile: BusinessProfile = {
    businessName: settingsMap.business_name || undefined,
    pitch: settingsMap.business_pitch || undefined,
  };

  try {
    const suggestions = await recommendGroupsToJoin(trade, location, businessProfile);
    // Charged only after a successful generation, so a failed AI call never
    // costs the customer anything.
    await spendCredits(supabase, user.id, CREDIT_COSTS.groupRecommendations, "group_recommendations", {
      trade,
      location,
      returned: suggestions.length,
    });
    return NextResponse.json({ suggestions });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({ error: error.message }, { status: 402 });
    }
    const message = error instanceof Error ? error.message : "Couldn't generate suggestions";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
