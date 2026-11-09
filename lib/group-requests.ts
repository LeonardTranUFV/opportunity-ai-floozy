/** The rules for clients asking Floozy to watch a Facebook group. No I/O, so `npm run check` covers them. */

export type GroupRequestStatus = "requested" | "joining" | "active" | "declined";

export const GROUP_REQUEST_STATUS_LABEL: Record<GroupRequestStatus, string> = {
  requested: "Waiting for Floozy",
  joining: "Floozy is joining",
  active: "Collecting",
  declined: "Declined",
};

/** One canonical link per group, whatever page of it was pasted. Null if it isn't a group link. */
export function cleanFacebookGroupUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return null;
  const [section, group] = parsed.pathname.split("/").filter(Boolean);
  if (section !== "groups" || !group) return null;
  return `https://www.facebook.com/groups/${group}`;
}

export type RequestInput = { url: string; name: string | null; note: string | null };

export function parseGroupRequest(body: Record<string, unknown>): { ok: true; input: RequestInput } | { ok: false; error: string } {
  const url = cleanFacebookGroupUrl(body.url);
  if (!url) return { ok: false, error: "That doesn't look like a Facebook group link. It should start with facebook.com/groups/" };
  const text = (value: unknown, max: number) => {
    const clean = typeof value === "string" ? value.trim().slice(0, max) : "";
    return clean || null;
  };
  return { ok: true, input: { url, name: text(body.name, 200), note: text(body.note, 500) } };
}

export type GroupReview =
  | { action: "joining"; collectorId: string }
  | { action: "activate"; collectorId: string; areaId: string; access: "public" | "private" }
  | { action: "decline"; reason: string | null };

/** Checks an operator's decision on a request before anything is written. */
export function parseGroupReview(
  body: Record<string, unknown>,
  collectors: ReadonlySet<string>,
  areaIds: ReadonlySet<string>
): { ok: true; review: GroupReview } | { ok: false; error: string } {
  if (body.action === "decline") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
    return { ok: true, review: { action: "decline", reason: reason || null } };
  }
  if (body.action !== "joining" && body.action !== "activate") return { ok: false, error: "Unknown action." };

  const collectorId = typeof body.collectorId === "string" ? body.collectorId : "";
  if (!collectors.has(collectorId)) return { ok: false, error: "Pick which Floozy Facebook account is joining." };
  if (body.action === "joining") return { ok: true, review: { action: "joining", collectorId } };

  const areaId = typeof body.areaId === "string" ? body.areaId : "";
  if (!areaIds.has(areaId)) return { ok: false, error: "Pick the area this group covers." };
  if (body.access !== "public" && body.access !== "private") return { ok: false, error: "Say whether the group is public or private." };
  return { ok: true, review: { action: "activate", collectorId, areaId, access: body.access } };
}
