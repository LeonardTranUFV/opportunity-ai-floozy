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
