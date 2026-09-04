/**
 * Finds the first complete {...} object in a string by tracking brace depth,
 * rather than assuming the rest of the string is pure JSON — callers
 * (e.g. the scan route) append extra context after the JSON error body, like
 * "(evaluated 12 of 140 posts before this failure)", which makes a naive
 * JSON.parse(raw.slice(jsonStart)) throw on the trailing text and silently
 * fall through to an unhelpful raw prefix instead of the friendly message.
 */
function extractFirstJsonObject(raw: string, startIndex: number): string | null {
  let depth = 0
  for (let i = startIndex; i < raw.length; i++) {
    if (raw[i] === "{") depth++
    else if (raw[i] === "}") {
      depth--
      if (depth === 0) return raw.slice(startIndex, i + 1)
    }
  }
  return null
}

/**
 * Turn a raw Gemini API error string (often a full JSON error body) into a short,
 * human-readable message instead of dumping the raw blob in the UI.
 */
export function formatApiError(raw: string | undefined | null): string {
  if (!raw) return "Something went wrong."

  const jsonStart = raw.indexOf("{")
  if (jsonStart === -1) return raw

  const jsonSlice = extractFirstJsonObject(raw, jsonStart)
  const suffix = jsonSlice ? raw.slice(jsonStart + jsonSlice.length).trim() : ""

  if (jsonSlice) {
    try {
      const parsed = JSON.parse(jsonSlice)
      const status: string | undefined = parsed?.error?.status
      const message: string | undefined = parsed?.error?.message

      if (status === "RESOURCE_EXHAUSTED") {
        // Measured 2026-08-12, not guessed: the free tier caps at roughly five
        // requests PER MINUTE, and the quota is per project — so every account
        // shares one bucket and a busy minute elsewhere can exhaust yours.
        // The old copy said "20 requests/day", which sent people away for the
        // rest of the day over a limit that clears in about a minute.
        return (
          "The AI is rate-limited right now — the free tier allows only about five requests a minute across the whole app. Wait a minute and try again. Adding billing to the Google Cloud project removes this." +
          (suffix ? ` ${suffix}` : "")
        )
      }
      if (status === "UNAVAILABLE") {
        return "Gemini is temporarily overloaded — wait a few seconds and try again." + (suffix ? ` ${suffix}` : "")
      }
      if (message) {
        const trimmed = message.length > 180 ? `${message.slice(0, 180)}…` : message
        return trimmed + (suffix ? ` ${suffix}` : "")
      }
    } catch {
      // fall through to raw prefix below
    }
  }

  const prefix = raw.slice(0, jsonStart).trim()
  return prefix || "The AI request failed. Try again in a moment."
}

/**
 * The message for a request the server refused, taken from the server.
 *
 * Every mutation in the app used to answer failure with its own fixed string —
 * "Failed to delete agent", "Failed to update status" — and throw the response
 * body away. That body is where the useful sentence lives: the source limit,
 * a validation message, the reason a comment could not be posted. A customer
 * shown "Failed to update group" over a 409 that said exactly what to do has
 * been handed a bug report instead of an instruction.
 *
 * Read as text first, because a run the platform cut off comes back as a 504
 * whose body is an HTML page, and res.json() throwing on that is how several
 * of these ended up in a catch block saying "check the server log".
 */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  const raw = await res.text().catch(() => "")
  try {
    const data = JSON.parse(raw) as { error?: unknown }
    if (typeof data?.error === "string" && data.error.trim()) return formatApiError(data.error)
  } catch {
    // Not JSON — fall through to the status-based message.
  }
  if (res.status === 504 || res.status === 502) {
    return "That took longer than the server allows and was stopped partway. Try again — it carries on from where it stopped."
  }
  return `${fallback} (the server returned ${res.status}).`
}

/**
 * The message when the request never got an answer at all.
 *
 * A fetch that throws is a network problem, not a server one — the phone lost
 * signal, a tunnel, a captive portal. "Check the server log" is the one thing
 * a customer cannot do; checking their connection is the one thing they can.
 */
export const CONNECTION_ERROR = "Couldn't reach the server — check your connection and try again."
