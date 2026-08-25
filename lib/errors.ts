/**
 * The message from a caught value, without asserting it is an Error.
 *
 * `catch (e: any)` followed by `e.message` reads fine until the thrown value
 * isn't an Error — a rejected string, a Playwright timeout object, anything
 * from inside `page.evaluate` — and then the handler itself throws while
 * reporting the original failure, which is how a clear error turns into an
 * unhandled one. Narrowing here keeps the report honest whatever was thrown.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
