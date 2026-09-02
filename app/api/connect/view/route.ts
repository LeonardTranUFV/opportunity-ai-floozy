import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRemoteBrowserProvider } from "@/lib/remote-browser";

/**
 * Re-attach the screen to a browser that is still running.
 *
 * The live view and the browser are separate things, and only the first one
 * breaks. The provider's session records show browsers alive for their full
 * five minutes while the customer watched a frozen picture — the viewer stops
 * following when the page navigates, which on a login flow is precisely the
 * moment credentials are submitted and the site moves to a 2FA screen.
 *
 * Before this existed the only recovery was starting over, which throws away a
 * login that had actually succeeded and sends the customer back to a password
 * box for no reason they can see.
 *
 * Ownership is re-checked here for the same reason /api/connect/finish checks
 * it: a session id travels through the customer's own browser, so it is a
 * claim rather than proof. A live-view URL is a window onto whatever is on
 * that screen — including, mid-login, somebody's password field.
 */

export const dynamic = "force-dynamic";

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

  const info = await provider.getSession(sessionId);
  if (!info) {
    return NextResponse.json(
      { error: "That browser session has expired. Start the connection again." },
      { status: 410 }
    );
  }

  // 404 rather than 403 on mismatch: someone probing ids should not be able to
  // tell "exists but not yours" from "does not exist".
  if (info.ownerUserId !== user.id) {
    console.warn(
      `[connect] user ${user.id} asked for the live view of session ${sessionId} owned by ${info.ownerUserId ?? "nobody"}`
    );
    return NextResponse.json({ error: "Unknown browser session." }, { status: 404 });
  }

  const liveViewUrl = await provider.refreshLiveView(sessionId);
  if (!liveViewUrl) {
    return NextResponse.json(
      { error: "That browser session has expired. Start the connection again." },
      { status: 410 }
    );
  }

  return NextResponse.json({ liveViewUrl });
}
