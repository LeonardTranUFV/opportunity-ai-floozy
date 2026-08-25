import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRemoteBrowserProvider } from "@/lib/remote-browser";

/**
 * Release a cloud browser the customer walked away from.
 *
 * Without this, every abandoned connect — a closed tab, a "Cancel", a second
 * thought at the Facebook login screen — leaves a browser running until its
 * idle timeout. Each one is billed, and nothing else would ever reap them.
 *
 * Called on a best-effort basis from the client (including via `keepalive`
 * during page unload), so it is written to be safe when it arrives twice, late,
 * or for a session the provider has already reaped.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const provider = getRemoteBrowserProvider();
  if (!provider) {
    return NextResponse.json({ error: "No cloud browser is configured." }, { status: 501 });
  }

  let sessionId: string;
  try {
    const body = (await request.json()) as { sessionId?: unknown };
    sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  // Same ownership rule as finish, for a smaller prize: without it, a caller
  // who guessed session ids could close other customers' browsers mid-login.
  // An already-gone session reports success — the caller asked for it to be
  // released and it is.
  const info = await provider.getSession(sessionId);
  if (!info) return NextResponse.json({ success: true, alreadyReleased: true });
  if (info.ownerUserId !== user.id) {
    return NextResponse.json({ error: "Unknown browser session." }, { status: 404 });
  }

  try {
    await provider.endSession(sessionId);
  } catch (error) {
    // The provider's own idle timeout is the backstop, so a failure here costs
    // minutes of browser time rather than correctness. Log it and tell the
    // client it is done; there is nothing useful for them to retry.
    console.error(`[connect] failed to release session ${sessionId}:`, error);
  }

  return NextResponse.json({ success: true });
}
