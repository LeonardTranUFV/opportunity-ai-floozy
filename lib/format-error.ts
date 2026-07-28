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
        return (
          "Gemini's free-tier daily quota is used up (20 requests/day). Try again later, or add billing to your Google AI Studio project for higher limits." +
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
