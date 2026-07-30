import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_INTERVALS = [1, 4, 12];

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (!("auto_scan_interval_hours" in body)) {
    return NextResponse.json({ success: false, error: "Nothing to update" }, { status: 400 });
  }

  const raw = body.auto_scan_interval_hours;
  if (raw !== null && !ALLOWED_INTERVALS.includes(raw)) {
    return NextResponse.json({ success: false, error: "Invalid auto_scan_interval_hours" }, { status: 400 });
  }

  const { error } = await supabase
    .from("agents")
    .update({ auto_scan_interval_hours: raw })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
