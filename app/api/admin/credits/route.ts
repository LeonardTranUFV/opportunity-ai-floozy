import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/admin";
import { grantCredits, spendCredits, InsufficientCreditsError } from "@/lib/credits";

// Manual credit adjustments — for granting credits after a bug, a goodwill
// gesture, or setting a new customer's plan allowance by hand while billing
// activation is still manual. Every adjustment is logged to
// credit_transactions with reason "admin_grant" (or "admin_deduct") plus
// which admin made it and why, same audit trail as any other credit change.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  // Admin status must be re-verified server-side against the caller's own
  // session on every request — never trust a client-supplied "isAdmin" flag.
  if (!(await isAdmin(supabase, user.id))) {
    return NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const targetUserId = typeof body.userId === "string" ? body.userId : null;
  const amount = Number(body.amount);
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : "";

  if (!targetUserId || !Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ success: false, error: "userId and a non-zero amount are required" }, { status: 400 });
  }

  // Uses the admin (service-role) client because this writes to another
  // user's row, which the caller's own RLS-scoped client can't do — the
  // isAdmin() check above is what makes that safe.
  const adminSupabase = createAdminClient();

  try {
    const newBalance =
      amount > 0
        ? await grantCredits(adminSupabase, targetUserId, amount, "admin_grant", { admin_id: user.id, note })
        : await spendCredits(adminSupabase, targetUserId, Math.abs(amount), "admin_deduct", { admin_id: user.id, note });

    return NextResponse.json({ success: true, balance: newBalance });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Failed to adjust credits";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
