/**
 * Turn a raw Gemini API error string (often a full JSON error body) into a short,
 * human-readable message instead of dumping the raw blob in the UI.
 */
export function formatApiError(raw: string | undefined | null): string {
  if (!raw) return "Something went wrong."

  const jsonStart = raw.indexOf("{")
  if (jsonStart === -1) return raw

  try {
    const parsed = JSON.parse(raw.slice(jsonStart))
    const status: string | undefined = parsed?.error?.status
    const message: string | undefined = parsed?.error?.message

    if (status === "RESOURCE_EXHAUSTED") {
      return "Gemini's free-tier daily quota is used up (20 requests/day). Try again later, or add billing to your Google AI Studio project for higher limits."
    }
    if (status === "UNAVAILABLE") {
      return "Gemini is temporarily overloaded — wait a few seconds and try again."
    }
    if (message) {
      return message.length > 180 ? `${message.slice(0, 180)}…` : message
    }
  } catch {
    // fall through to raw prefix below
  }

  const prefix = raw.slice(0, jsonStart).trim()
  return prefix || "The AI request failed. Try again in a moment."
}
