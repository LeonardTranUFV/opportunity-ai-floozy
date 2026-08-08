import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enhanceAgentProfile, type BusinessProfile } from "@/lib/ai";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const rl = await rateLimit(`agent-enhance:${user.id}`, LIMITS.ai.limit, LIMITS.ai.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "AI requests");

  const body = await request.json().catch(() => ({}));
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length < 10) {
    return NextResponse.json(
      { success: false, error: "Write a sentence or two about your business first." },
      { status: 400 }
    );
  }

  const { data: settingsRows } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["business_owner_name", "business_name", "business_phone", "business_pitch"]);
  const settingsMap = Object.fromEntries((settingsRows ?? []).map((r) => [r.key, r.value]));
  const businessProfile: BusinessProfile = {
    ownerName: settingsMap.business_owner_name || undefined,
    businessName: settingsMap.business_name || undefined,
    phone: settingsMap.business_phone || undefined,
    pitch: settingsMap.business_pitch || undefined,
  };

  try {
    const enhancement = await enhanceAgentProfile(description, businessProfile);
    return NextResponse.json({ success: true, ...enhancement });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI enhancement failed";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
