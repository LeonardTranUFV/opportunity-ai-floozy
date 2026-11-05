import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";
import {
  loadCompanyProfile,
  loadServiceAreas,
  normalizeProfileInput,
  saveCompanyProfile,
} from "@/lib/company-profile";

/** The signed-in client's company profile and service areas. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(`profile-read:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "requests");

  try {
    const { profile, migrated } = await loadCompanyProfile(supabase, user.id);
    return NextResponse.json({ profile, migrated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't load your company profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Replaces the whole profile, areas included. */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const rl = await rateLimit(`profile-write:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "saves");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That wasn't a valid form submission." }, { status: 400 });
  }

  const parsed = normalizeProfileInput(body, await loadServiceAreas(supabase));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const { migrated } = await saveCompanyProfile(supabase, user.id, parsed.profile);
    return NextResponse.json({ success: true, migrated, profile: parsed.profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't save your company profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
