import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_DAYS = [7, 14, 30, 60];

// Only clears "New" (never acted on) and "Lost" (explicitly rejected) leads —
// anything further along the pipeline (qualified/appointment/proposal/won)
// represents a real deal in progress and should never be silently deleted
// just because it's old.
const CLEARABLE_STATUSES = ["new", "lost"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const days = ALLOWED_DAYS.includes(body.days) ? body.days : 14;

  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { error, count } = await supabase
    .from("opportunities")
    .delete({ count: "exact" })
    .lt("created_at", cutoffIso)
    .in("status", CLEARABLE_STATUSES);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, deleted: count ?? 0, days });
}
