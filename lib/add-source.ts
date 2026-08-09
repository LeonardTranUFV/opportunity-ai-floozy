/**
 * Adding a found group to the monitored list, shared by every surface that
 * offers it (AI recommendations, Discover search, and anything added later).
 *
 * This exists because there were two hand-written copies of the same fetch and
 * they had quietly drifted: one refreshed the page and reported failures, the
 * other did neither. The one that didn't refresh looked broken — the row went
 * into the database correctly, but the Monitored Sources list on the same page
 * is server-rendered, so nothing appeared until a manual reload, and the user
 * reasonably concluded the button did nothing.
 */
export interface AddableSource {
  platform: string;
  name: string;
  url: string;
}

export type AddSourceResult = { ok: true } | { ok: false; error: string };

export async function addSource(group: AddableSource): Promise<AddSourceResult> {
  try {
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...group, active: true }),
    });

    // 409 means it is already on the monitored list, which is the state the
    // click was asking for — reporting that as an error would be a lie.
    if (res.ok || res.status === 409) return { ok: true };

    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || `Couldn't add that group (${res.status}).` };
  } catch {
    return { ok: false, error: "Couldn't reach the server — try again." };
  }
}
