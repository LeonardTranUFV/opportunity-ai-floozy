import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminIdentity } from "@/lib/privileges";
import { hasSessionKey } from "@/lib/session-crypto";
import { SWITCH_LIFETIME_MS, decideSwitch } from "@/lib/account-switch";
import {
  clearOperatorPass,
  readOperatorPass,
  writeOperatorPass,
} from "@/lib/account-switch-server";
import { readJsonBody, validationErrorResponse } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * Signs an operator in as a client, into another client, or back to themselves.
 * The target is mailed nothing: generateLink only creates the one-time token,
 * and it is spent right here.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    return validationErrorResponse(err) ?? NextResponse.json({ success: false, error: "Bad request" }, { status: 400 });
  }
  const targetUserId = typeof body.userId === "string" ? body.userId : "";
  if (!targetUserId) {
    return NextResponse.json({ success: false, error: "userId is required" }, { status: 400 });
  }

  if (!hasSessionKey()) {
    return NextResponse.json(
      { success: false, error: "Account switching needs SESSION_ENCRYPTION_KEY to be set." },
      { status: 503 }
    );
  }

  const admin = createAdminClient();
  const stored = await readOperatorPass();
  const pass = stored?.viewingId === user.id ? stored : null;

  const [{ data: target }, operator] = await Promise.all([
    admin.auth.admin.getUserById(targetUserId),
    pass ? admin.auth.admin.getUserById(pass.operatorId) : Promise.resolve(null),
  ]);

  const decision = decideSwitch({
    sessionUserId: user.id,
    targetUserId,
    pass,
    sessionIsAdmin: isAdminIdentity(user.id, user.email),
    passOperatorIsAdmin: operator?.data.user
      ? isAdminIdentity(operator.data.user.id, operator.data.user.email)
      : false,
    targetIsAdmin: target.user ? isAdminIdentity(target.user.id, target.user.email) : false,
    now: Date.now(),
  });

  if (!decision.ok) {
    if (decision.expired) {
      // Local only: signing out everywhere would also end the client's own logins.
      await supabase.auth.signOut({ scope: "local" });
      await clearOperatorPass();
    }
    return NextResponse.json(
      { success: false, error: decision.error, expired: decision.expired ?? false },
      { status: decision.status }
    );
  }

  if (targetUserId === user.id) {
    return NextResponse.json({ success: true });
  }

  if (!target.user?.email) {
    return NextResponse.json({ success: false, error: "Account not found" }, { status: 404 });
  }
  // Spending a magic link confirms the address, which should only ever be the
  // owner's doing.
  if (!target.user.email_confirmed_at) {
    return NextResponse.json(
      { success: false, error: "This client hasn't confirmed their email yet." },
      { status: 409 }
    );
  }

  const {
    data: { session: previous },
  } = await supabase.auth.getSession();

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: target.user.email,
  });
  if (linkError || !link.properties?.hashed_token) {
    console.error("[switch-account] could not create a sign-in link:", linkError?.message);
    return NextResponse.json({ success: false, error: "Could not switch accounts." }, { status: 500 });
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyError) {
    console.error("[switch-account] could not sign in:", verifyError.message);
    return NextResponse.json({ success: false, error: "Could not switch accounts." }, { status: 500 });
  }

  if (targetUserId === decision.operatorId) {
    await clearOperatorPass();
  } else {
    await writeOperatorPass({
      operatorId: decision.operatorId,
      viewingId: targetUserId,
      expiresAt: Date.now() + SWITCH_LIFETIME_MS,
    });
  }

  // End the session being left, so switching back and forth doesn't pile up
  // live sessions on the client's account. Best effort: the cookies already
  // moved on, and an old token that fails here simply expires by itself.
  if (previous?.access_token) {
    await admin.auth.admin.signOut(previous.access_token, "local").catch(() => undefined);
  }

  // Logged first so the record survives even if the insert fails.
  console.info(
    `[switch-account] operator=${decision.operatorId} from=${user.id} to=${targetUserId}`
  );
  const { error: logError } = await admin.from("account_switches").insert({
    operator_id: decision.operatorId,
    from_user_id: user.id,
    to_user_id: targetUserId,
  });
  if (logError) console.error("[switch-account] audit insert failed:", logError.message);

  return NextResponse.json({ success: true });
}
