import crypto from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentOperator } from "@/lib/operator";
import { COLLECTION_MODE_KEY } from "@/lib/collection-mode";
import { readJsonBody, validationErrorResponse } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * Adds a Floozy Facebook account. Each one is its own app account because
 * logins are stored per account and platform. Nobody signs in to the app
 * account itself: its password is random and never kept, and the address has no
 * mailbox and is never sent to.
 */
export async function POST(request: Request) {
  if (!(await currentOperator())) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    return validationErrorResponse(err) ?? NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "";
  if (!label) return NextResponse.json({ error: "Give this account a name your team will recognise." }, { status: 400 });

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: `collector-${crypto.randomBytes(5).toString("hex")}@app.floozy.ca`,
    password: crypto.randomBytes(32).toString("hex"),
    email_confirm: true,
  });
  if (createError || !created.user) {
    console.error("[facebook-accounts] could not create the account:", createError?.message);
    return NextResponse.json({ error: "Could not add that account." }, { status: 500 });
  }

  const userId = created.user.id;
  const [{ error: collectorError }, { error: modeError }] = await Promise.all([
    admin.from("floozy_collectors").insert({ user_id: userId, label }),
    // Keeps the hosted crawler off this account: it's read by Apify or the PC worker.
    admin.from("settings").upsert({ user_id: userId, key: COLLECTION_MODE_KEY, value: "local:facebook" }, { onConflict: "user_id,key" }),
  ]);
  if (collectorError || modeError) {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    console.error("[facebook-accounts] could not save:", collectorError?.message ?? modeError?.message);
    return NextResponse.json({ error: "Could not add that account. Has migration 0025 been applied?" }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: userId });
}
