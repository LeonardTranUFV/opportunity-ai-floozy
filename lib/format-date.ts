/**
 * Dates formatted the same way on the server and in the browser.
 *
 * Every call site used to be `toLocaleString(undefined, …)`. `undefined` means
 * "whatever locale and time zone this runtime happens to have", and the server
 * and the browser do not have the same ones — so React threw a hydration
 * mismatch on the dashboard:
 *
 *     Client:  Aug 6, 10:02 AM
 *     Server:  Aug 6, 10:02 a.m.
 *
 * The formatting difference is what surfaced the bug. The **time zone** is the
 * part that mattered: Vercel runs UTC, Leo is in Vancouver, so the
 * server-rendered HTML carried a timestamp seven or eight hours off until React
 * replaced it. A visible mismatch warning is a lucky outcome — the same fault
 * on a page React does not re-render would have quietly shown the wrong hour.
 *
 * Both are pinned. Floozy operates from Vancouver and its customers are BC
 * contractors, so business time is Pacific and everyone reading a lead's
 * timestamp should read the same one — including the person checking their
 * phone in another province.
 */

/** Where the business is. Timestamps mean this, wherever they are rendered. */
export const BUSINESS_TIME_ZONE = "America/Vancouver";

/** Pinned so `a.m.` and `AM` cannot depend on who is looking. */
export const BUSINESS_LOCALE = "en-CA";

const dateTime = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});

const dateOnly = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  month: "short",
  day: "numeric",
  timeZone: BUSINESS_TIME_ZONE,
});

const dateFull = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});

/** "Aug 6, 10:02 a.m." — identical on both sides of the render. */
export function formatDateTime(value: string | number | Date): string {
  return dateTime.format(toDate(value));
}

/** "Aug 6" */
export function formatDate(value: string | number | Date): string {
  return dateOnly.format(toDate(value));
}

/** "Aug 6, 2026, 10:02 a.m." — for anywhere the year matters. */
export function formatDateTimeFull(value: string | number | Date): string {
  return dateFull.format(toDate(value));
}

/**
 * Relative labels are safe to render on the server *only* because the cutoffs
 * are coarse. "2h ago" computed a second apart on server and client still reads
 * "2h ago"; a seconds-level label would not, and would reintroduce the bug.
 */
export function formatRelative(value: string | number | Date, now: Date = new Date()): string {
  const d = toDate(value);
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(d);
}

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
