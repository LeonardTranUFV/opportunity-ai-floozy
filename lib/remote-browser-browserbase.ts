import type {
  RemoteBrowserProvider,
  RemoteSession,
  RemoteSessionInfo,
  StartSessionOptions,
} from "@/lib/remote-browser";

/**
 * Browserbase adapter — the only file in the app that knows this vendor exists.
 *
 * Written against the REST API directly rather than the SDK: the whole surface
 * is three calls, and a dependency that ships its own Playwright peer would
 * fight the pinned one this project already uses for local crawling.
 *
 * Endpoints, all under https://api.browserbase.com/v1 with an X-BB-API-Key
 * header:
 *
 *   POST /sessions              -> { id, connectUrl, status, ... }
 *   GET  /sessions/{id}/debug   -> { debuggerFullscreenUrl, debuggerUrl, ... }
 *   POST /sessions/{id}         -> release, via { status: "REQUEST_RELEASE" }
 */

const API_ROOT = "https://api.browserbase.com/v1";

/**
 * Long enough for a real person to find their phone, open an authenticator and
 * type a code, and short enough that an abandoned tab does not bill for an
 * hour. Connect is the slowest thing this provider is used for; crawls attach
 * to their own short-lived sessions.
 *
 * 600 since the account moved off the free tier, which capped sessions at five
 * minutes and rejected a larger `timeout` outright. Verified against the live
 * account before changing it: creating a session with timeout 600 returns 201.
 *
 * Five minutes was genuinely tight. A real connect spent most of it waiting on
 * an SMS code, and the clock starts when the browser boots — 15-25 seconds go
 * on launching Chrome and loading the login page before a password box even
 * appears. Ten leaves room for a slow code, a mistyped password, and the extra
 * verification Meta adds for a login it has not seen before.
 *
 * Kept in step with SESSION_SECONDS in components/accounts/cloud-connect.tsx,
 * which shows this number to the customer as a countdown.
 */
const DEFAULT_IDLE_TIMEOUT_SECONDS = 600;

/**
 * How long the generated live-view URL stays valid. Matched to the session
 * timeout: a link that outlives its browser is a dead iframe, and one that
 * expires early strands someone mid-login.
 */
const LIVE_VIEW_TTL_SECONDS = DEFAULT_IDLE_TIMEOUT_SECONDS;

type CreateSessionResponse = {
  id: string;
  connectUrl: string;
  status: string;
};

type DebugResponse = {
  debuggerFullscreenUrl?: string;
  debuggerUrl?: string;
};

type GetSessionResponse = {
  id: string;
  connectUrl: string;
  status: string;
  userMetadata?: Record<string, unknown> | null;
};

function apiKey(): string | undefined {
  return process.env.BROWSERBASE_API_KEY;
}

function projectId(): string | undefined {
  return process.env.BROWSERBASE_PROJECT_ID;
}

async function callApi<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("BROWSERBASE_API_KEY is not set.");

  const res = await fetch(`${API_ROOT}${path}`, {
    method: init.method,
    headers: {
      "X-BB-API-Key": key,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    // Bounded so a vendor outage surfaces as a failed connect the customer can
    // retry, rather than a request that hangs until the platform kills it.
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    // Include the body: Browserbase puts the actionable part (out of
    // concurrency, bad project id, exhausted proxy quota) in the payload, and
    // the bare status alone sends whoever is debugging the wrong way.
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Browserbase ${init.method} ${path} failed (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`
    );
  }

  return (await res.json()) as T;
}

export const browserbaseProvider: RemoteBrowserProvider = {
  name: "Browserbase",

  isConfigured() {
    return Boolean(apiKey() && projectId());
  },

  async startSession(options: StartSessionOptions): Promise<RemoteSession> {
    const project = projectId();
    if (!project) throw new Error("BROWSERBASE_PROJECT_ID is not set.");

    const session = await callApi<CreateSessionResponse>("/sessions", {
      method: "POST",
      body: {
        projectId: project,
        timeout: options.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS,

        // keepAlive so the browser survives the moment between the customer
        // finishing login and our own Playwright attaching to read the
        // cookies. Without it a disconnect can tear the session down with the
        // login still only in the browser's memory.
        keepAlive: true,

        // Stamped at creation so the finish step can prove the caller owns
        // this session before reading cookies out of it. See
        // RemoteSessionInfo — a session id is not a capability.
        userMetadata: {
          userId: options.userId,
          platform: options.platform,
        },

        /**
         * Route through a proxy whenever one is configured for this customer.
         * Datacentre egress shared across every customer is the fastest way to
         * get an entire fleet flagged, since platforms weight IP reputation far
         * above page behaviour.
         *
         * The country is configurable and defaults to CA rather than being
         * pinned to US. A real connect produced a Facebook security alert
         * reading "login near Atlanta, GA" for a customer in Vancouver — the
         * proxy was doing its job of looking residential, and then undermined
         * it by placing them 3,000km away. A login from the wrong country is
         * its own alarm, and the customer is the one who gets the frightening
         * email about it.
         *
         * This should eventually follow the customer's own service area rather
         * than one account-wide setting; CONNECT_PROXY_COUNTRY is the stopgap
         * while every customer is in one market.
         */
        proxies: options.proxyId
          ? [
              {
                type: "browserbase",
                geolocation: { country: process.env.CONNECT_PROXY_COUNTRY || "CA" },
              },
            ]
          : undefined,

        browserSettings: {
          viewport: { width: 1280, height: 900 },

          // No ad blocking: it changes the DOM the extractors in lib/scraper.ts
          // were written against, and a "helpful" rewrite of the page is
          // indistinguishable from a layout change when a selector breaks.
          blockAds: false,
        },
      },
    });

    // A separate call, because the live-view URLs are minted on demand with
    // their own TTL rather than returned with the session.
    const debug = await callApi<DebugResponse>(
      `/sessions/${session.id}/debug?expiresIn=${LIVE_VIEW_TTL_SECONDS}`,
      { method: "GET" }
    );

    const liveViewUrl = debug.debuggerFullscreenUrl ?? debug.debuggerUrl;
    if (!liveViewUrl) {
      // Release rather than leak: the session is already running and billing.
      await this.endSession(session.id).catch(() => {});
      throw new Error("Browserbase returned no live view URL for the session.");
    }

    return {
      id: session.id,
      // Carries the API key in its query string — server-side only, never
      // serialised to the client. See app/api/connect/*.
      connectUrl: session.connectUrl,
      liveViewUrl,
    };
  },

  async refreshLiveView(sessionId: string): Promise<string | null> {
    try {
      const debug = await callApi<DebugResponse>(
        `/sessions/${sessionId}/debug?expiresIn=${LIVE_VIEW_TTL_SECONDS}`,
        { method: "GET" }
      );
      return debug.debuggerFullscreenUrl ?? debug.debuggerUrl ?? null;
    } catch {
      // A session already reclaimed by the vendor answers with an error here.
      // Null lets the caller say "that login expired, start again" instead of
      // surfacing a provider failure to somebody mid-login.
      return null;
    }
  },

  async getSession(sessionId: string): Promise<RemoteSessionInfo | null> {
    let session: GetSessionResponse;
    try {
      session = await callApi<GetSessionResponse>(`/sessions/${sessionId}`, {
        method: "GET",
      });
    } catch {
      // An unknown id is an ordinary outcome here — a stale tab, a session the
      // vendor already reaped — not an exceptional one. The caller turns it
      // into "that login expired, start again".
      return null;
    }

    const metadata = session.userMetadata ?? {};
    const ownerUserId = typeof metadata.userId === "string" ? metadata.userId : null;
    const platform = typeof metadata.platform === "string" ? metadata.platform : null;

    return { id: session.id, connectUrl: session.connectUrl, status: session.status, ownerUserId, platform };
  },

  async endSession(sessionId: string): Promise<void> {
    await callApi(`/sessions/${sessionId}`, {
      method: "POST",
      body: { projectId: projectId(), status: "REQUEST_RELEASE" },
    });
  },
};
