import { browserbaseProvider } from "@/lib/remote-browser-browserbase";

/**
 * The boundary between "we need a signed-in Chrome somewhere" and "who is
 * actually hosting that Chrome".
 *
 * Self-serve connect needs a browser the customer can *see and drive* — they
 * type their own Facebook password into it, and we never handle the
 * credential. That means a real browser, running somewhere with a screen we
 * can stream, which is precisely what a serverless function is not.
 *
 * Managed browser vendors all expose the same three things under different
 * names: start a session, hand back a URL you can put in an iframe, and let
 * Playwright attach over CDP. Pinning the rest of the app to one vendor's
 * spelling of that would make switching a rewrite instead of a file, and the
 * economics here (per-browser-hour, at "everyone can scrape" volume) make
 * switching a question of when rather than if.
 *
 * So: the app depends on this interface. Exactly one file per vendor
 * implements it. lib/session-store.ts is what makes that switch cheap —
 * sessions are already stored as portable storageState rather than inside any
 * particular vendor's context store.
 */

export type RemoteSession = {
  /** Vendor's id for the session, for teardown and support tickets. */
  id: string;

  /**
   * Playwright connects here with `chromium.connectOverCDP(...)`. Usually
   * carries an auth token in the query string, so it is a secret: it must
   * never be handed to the browser.
   */
  connectUrl: string;

  /**
   * The page the customer actually looks at — an interactive stream of the
   * remote browser, safe to put in an iframe. This is the only field of this
   * object the client is allowed to see.
   */
  liveViewUrl: string;
};

export type StartSessionOptions = {
  /**
   * Which customer this browser is for. Passed to the vendor as metadata so a
   * runaway session can be traced back to an account, and so per-customer
   * concurrency limits are enforceable.
   */
  userId: string;

  platform: string;

  /**
   * Route this browser through a specific egress IP.
   *
   * Not optional in practice, whatever the type says. Every customer's crawl
   * leaving from the same datacentre range is the fastest way to get an entire
   * fleet flagged at once — the platforms score IP reputation far more heavily
   * than they score page behaviour. A sticky per-customer residential IP is
   * what makes many accounts browsing from one system look like many people
   * rather than one scraper.
   */
  proxyId?: string;

  /**
   * How long the vendor should keep the browser alive with nobody driving it.
   * Connect is a human logging in, including a 2FA detour to find their phone,
   * so this is minutes rather than seconds — but it is billed time, so it is
   * not unbounded either.
   */
  idleTimeoutSeconds?: number;
};

/**
 * A running session as looked up by id, including who it was started for.
 *
 * The ownership fields are the point. Connect spans two requests — start one
 * browser, come back later and read its cookies — and the only thing tying
 * them together is a session id held by the client in between. An id is not a
 * capability: whoever finishes a session gets the cookies out of it, so the
 * finish step has to prove the caller is the person the session was started
 * for. Without that, passing someone else's id harvests their login.
 *
 * Recorded with the vendor at creation rather than in our own table so the
 * check reads from the same source of truth that owns the browser.
 */
export type RemoteSessionInfo = {
  id: string;
  connectUrl: string;
  status: string;
  ownerUserId: string | null;
  platform: string | null;
};

export interface RemoteBrowserProvider {
  /** Human-readable, for logs and the Settings integrations list. */
  readonly name: string;

  /** Whether credentials for this provider are actually configured. */
  isConfigured(): boolean;

  /** Boot a browser and return the handles needed to drive and show it. */
  startSession(options: StartSessionOptions): Promise<RemoteSession>;

  /**
   * Look a session up by id, for the second half of connect. Returns null when
   * the vendor does not recognise the id.
   */
  getSession(sessionId: string): Promise<RemoteSessionInfo | null>;

  /**
   * Shut a session down. Called on success, on failure, and on abandonment —
   * an idle browser nobody closed is a line on the invoice, so this runs in a
   * finally, never only on the happy path.
   */
  endSession(sessionId: string): Promise<void>;
}

/**
 * The configured provider, or null when none is set up.
 *
 * Null is a legitimate state, not a broken install: it is what a purely local
 * deployment looks like, where connect happens through a Chrome window on the
 * operator's own machine and no remote browser is needed at all. Callers use
 * it to decide which connect flow to offer, so it must not throw.
 */
export function getRemoteBrowserProvider(): RemoteBrowserProvider | null {
  // Configuration is what selects a provider, not a build-time constant:
  // deployments differ (the operator's laptop has none, production has one),
  // and an unconfigured vendor must stay inert rather than half-active.
  // Silently defaulting to a provider nobody set up would surface as
  // mystifying billing.
  if (browserbaseProvider.isConfigured()) return browserbaseProvider;
  return null;
}

/**
 * Strip provider credentials out of text before it is logged or returned.
 *
 * `connectUrl` carries the provider API key in its query string, and Playwright
 * puts the URL it failed to reach into the error message. So the natural
 * `catch (err) { log(err); return { error: err.message } }` publishes our API
 * key — into Vercel's logs, and worse, into the customer's browser. Whoever
 * held it could then run browsers on our account until the bill stopped us.
 *
 * Applied at the boundary rather than trusted to callers: the leak happens in
 * exactly the code path nobody exercises until something is already going
 * wrong, which is the worst place to rely on remembering.
 */
export function redactProviderSecrets(text: string): string {
  return (
    text
      // ws(s):// and http(s):// URLs — these are what carry the key as a query
      // parameter. Replaced whole rather than parsed: a malformed URL in an
      // error string still needs redacting, and parsing it might throw.
      .replace(/\b(wss?|https?):\/\/[^\s"')]+/gi, "[redacted-url]")
      // Bare API keys, in case one is ever interpolated outside a URL.
      .replace(/\bbb_(live|test)_[A-Za-z0-9._-]+/g, "[redacted-key]")
      // Generic apiKey=... / token=... survivors.
      .replace(/\b(api[_-]?key|token|signingKey)=[^\s&"')]+/gi, "$1=[redacted]")
  );
}

/** Whether self-serve connect can be offered at all in this deployment. */
export function canConnectRemotely(): boolean {
  const provider = getRemoteBrowserProvider();
  return provider !== null && provider.isConfigured();
}
