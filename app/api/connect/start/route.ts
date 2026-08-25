import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRemoteBrowserProvider } from "@/lib/remote-browser";
import { isSessionPlatform, SESSION_PLATFORMS } from "@/lib/session-store";
import { hasSessionKey, SESSION_KEY_HINT } from "@/lib/session-crypto";
import { errorMessage } from "@/lib/errors";

/**
 * First half of self-serve connect: boot a cloud browser and hand the customer
 * a URL they can watch and type into.
 *
 * This is the route that makes the hosted product possible. The old connect
 * flow (app/api/auth-session/route.ts and siblings) opens a Chrome window on
 * the server's own desktop, which works exactly once — on the operator's PC —
 * and is why Connect Accounts has nothing to offer a hosted customer. Here the
 * browser runs at the provider and only its screen travels.
 *
 * The customer types their own password into that browser. We never see it,
 * never store it, and never proxy it; what we keep afterwards is the resulting
 * session, and only via /api/connect/finish.
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
    return NextResponse.json(
      {
        error:
          "No cloud browser is configured for this deployment, so accounts can only be connected locally.",
      },
      { status: 501 }
    );
  }

  // Checked before spending money on a browser, not after. Without a key the
  // finish step would refuse to store the session, and the customer would have
  // logged into Facebook for nothing.
  if (!hasSessionKey()) {
    console.error(`[connect] refusing to start: no session encryption key. ${SESSION_KEY_HINT}`);
    return NextResponse.json(
      { error: "Connecting accounts is temporarily unavailable. The team has been notified." },
      { status: 503 }
    );
  }

  let platform: string;
  try {
    const body = (await request.json()) as { platform?: unknown };
    platform = typeof body.platform === "string" ? body.platform : "";
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!isSessionPlatform(platform)) {
    return NextResponse.json(
      { error: `Unsupported platform. Expected one of: ${SESSION_PLATFORMS.join(", ")}.` },
      { status: 400 }
    );
  }

  try {
    const session = await provider.startSession({ userId: user.id, platform });

    // Only the id and the viewable URL cross to the client. connectUrl carries
    // the provider API key in its query string and stays on the server: it is
    // the difference between "watch this browser" and "drive any browser on
    // our account".
    return NextResponse.json({
      sessionId: session.id,
      liveViewUrl: session.liveViewUrl,
      platform,
    });
  } catch (error) {
    console.error(`[connect] could not start a ${platform} session:`, error);
    return NextResponse.json(
      { error: `Could not start a browser: ${errorMessage(error)}` },
      { status: 502 }
    );
  }
}
