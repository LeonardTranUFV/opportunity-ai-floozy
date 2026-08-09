/**
 * True when running as the hosted Vercel deployment rather than the
 * operator's local machine. Connect Accounts and Scrape both depend on a
 * real, visible Chrome window and a persistent local-disk browser profile
 * per user — neither exists on Vercel's serverless runtime (no persistent
 * filesystem between invocations, no installed browser, no display for a
 * human to log into). Those flows stay operator-only until the app moves
 * to an always-on server that can actually support them.
 */
export function isHostedDeployment(): boolean {
  return process.env.VERCEL === "1";
}

/**
 * What a browser-dependent API route tells the caller when it runs on the
 * hosted deployment. The pages already hide these buttons; this is the
 * backstop for anything that reaches the route anyway, so the answer is an
 * explanation rather than a crash.
 */
export const BROWSER_UNAVAILABLE =
  "This step drives a real Chrome window on the operator's machine, which the hosted site can't do. Run the app locally to use it.";
