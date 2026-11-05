/**
 * A client's company profile: who they are, what they do, where they work and
 * which jobs they want. Lives in `company_profiles` and `client_service_areas`
 * (migration 0021).
 *
 * Before 0021 the same information was four loose `settings` keys
 * (business_name, business_owner_name, business_phone, business_pitch). Those
 * keys are still written on every save and read as a fallback, for two
 * reasons: the code can deploy before somebody runs the migration in the
 * Supabase SQL editor (that already broke the free scan once, see
 * scripts/check-migrations.mjs), and a rollback of this code must not lose a
 * client's details.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessProfile } from "@/lib/ai";
import { AGENT_TEMPLATES } from "@/lib/agent-templates";
import { SERVICE_AREAS, type AreaChoice, type ServiceArea } from "@/lib/service-areas";

export interface CompanyProfile {
  businessName: string;
  ownerName: string;
  phone: string;
  website: string;
  about: string;
  trades: string[];
  services: string;
  yearsExperience: number | null;
  wantedJobs: string;
  unwantedJobs: string;
  areas: AreaChoice[];
}

export const EMPTY_PROFILE: CompanyProfile = {
  businessName: "",
  ownerName: "",
  phone: "",
  website: "",
  about: "",
  trades: [],
  services: "",
  yearsExperience: null,
  wantedJobs: "",
  unwantedJobs: "",
  areas: [],
};

/** The trades a client can pick, one per agent template. */
export const TRADE_OPTIONS = AGENT_TEMPLATES.map((t) => ({ id: t.id, label: t.label, icon: t.icon }));

export const PROFILE_LIMITS = {
  shortText: 120,
  website: 200,
  longText: 1000,
  trades: 5,
  areas: 3,
} as const;

/** The four settings keys the profile replaces, and which field each one feeds. */
export const LEGACY_SETTINGS_KEYS = {
  business_name: "businessName",
  business_owner_name: "ownerName",
  business_phone: "phone",
  business_pitch: "about",
} as const satisfies Record<string, keyof CompanyProfile>;

/** PostgREST / Postgres codes for "that table or column does not exist yet". */
const NOT_MIGRATED = new Set(["PGRST205", "PGRST204", "42P01", "42703"]);

export function isNotMigrated(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && NOT_MIGRATED.has(error.code)) return true;
  return /does not exist|schema cache/i.test(error.message ?? "");
}

export type ProfileInputResult = { ok: true; profile: CompanyProfile } | { ok: false; error: string };

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Turns a form submission into a clean profile, or says in plain words what is
 * wrong with it. Unknown trades and areas are refused rather than dropped, so
 * a stale form says so instead of silently saving less than it showed.
 */
export function normalizeProfileInput(
  body: unknown,
  areas: readonly ServiceArea[] = SERVICE_AREAS
): ProfileInputResult {
  if (!body || typeof body !== "object") return { ok: false, error: "Nothing to save." };
  const b = body as Record<string, unknown>;

  const website = str(b.website, PROFILE_LIMITS.website);
  if (website && !/^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(website)) {
    return { ok: false, error: "The website doesn't look like a web address." };
  }

  let yearsExperience: number | null = null;
  if (b.yearsExperience !== null && b.yearsExperience !== undefined && b.yearsExperience !== "") {
    const n = Number(b.yearsExperience);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return { ok: false, error: "Years of experience should be a whole number from 0 to 100." };
    }
    yearsExperience = n;
  }

  const rawTrades = Array.isArray(b.trades) ? b.trades.filter((t): t is string => typeof t === "string") : [];
  const trades = [...new Set(rawTrades)];
  const knownTrades = new Set(TRADE_OPTIONS.map((t) => t.id));
  const badTrade = trades.find((t) => !knownTrades.has(t));
  if (badTrade) return { ok: false, error: `Unknown trade: ${badTrade}.` };
  if (trades.length > PROFILE_LIMITS.trades) {
    return { ok: false, error: `Pick up to ${PROFILE_LIMITS.trades} trades.` };
  }

  const rawAreas = Array.isArray(b.areas) ? b.areas : [];
  const choices: AreaChoice[] = [];
  for (const raw of rawAreas) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "A service area is malformed." };
    const r = raw as Record<string, unknown>;
    const area = areas.find((a) => a.id === r.areaId);
    if (!area) return { ok: false, error: `Unknown service area: ${String(r.areaId)}.` };
    if (choices.some((c) => c.areaId === area.id)) continue;
    const picked = Array.isArray(r.cities) ? r.cities.filter((c): c is string => typeof c === "string") : [];
    const cities: string[] = [];
    for (const name of picked) {
      const match = area.cities.find((c) => c.toLowerCase() === name.trim().toLowerCase());
      if (!match) return { ok: false, error: `${name} isn't in ${area.name}.` };
      if (!cities.includes(match)) cities.push(match);
    }
    // Every city ticked is the same as "the whole area", and stays correct
    // when a city is added to the area later.
    choices.push({ areaId: area.id, cities: cities.length === area.cities.length ? [] : cities });
  }
  if (choices.length > PROFILE_LIMITS.areas) {
    return { ok: false, error: `Pick up to ${PROFILE_LIMITS.areas} service areas.` };
  }

  return {
    ok: true,
    profile: {
      businessName: str(b.businessName, PROFILE_LIMITS.shortText),
      ownerName: str(b.ownerName, PROFILE_LIMITS.shortText),
      phone: str(b.phone, PROFILE_LIMITS.shortText),
      website,
      about: str(b.about, PROFILE_LIMITS.longText),
      trades,
      services: str(b.services, PROFILE_LIMITS.longText),
      yearsExperience,
      wantedJobs: str(b.wantedJobs, PROFILE_LIMITS.longText),
      unwantedJobs: str(b.unwantedJobs, PROFILE_LIMITS.longText),
      areas: choices,
    },
  };
}

/** What the AI prompts get. Only fields the client actually filled in. */
export function toBusinessProfile(p: CompanyProfile): BusinessProfile {
  const pitchParts = [
    p.about,
    p.yearsExperience ? `${p.yearsExperience} years in the trade` : "",
    p.services ? `Services: ${p.services}` : "",
  ].filter(Boolean);
  return {
    ownerName: p.ownerName || undefined,
    businessName: p.businessName || undefined,
    phone: p.phone || undefined,
    pitch: pitchParts.length ? pitchParts.join(". ") : undefined,
  };
}

interface ProfileRow {
  business_name: string | null;
  owner_name: string | null;
  phone: string | null;
  website: string | null;
  about: string | null;
  trades: string[] | null;
  services: string | null;
  years_experience: number | null;
  wanted_jobs: string | null;
  unwanted_jobs: string | null;
}

export interface LoadedProfile {
  profile: CompanyProfile;
  /** false = migration 0021 is not applied, so only the four legacy fields exist. */
  migrated: boolean;
}

async function loadLegacy(supabase: SupabaseClient, userId: string): Promise<CompanyProfile> {
  const { data } = await supabase
    .from("settings")
    .select("key, value")
    .eq("user_id", userId)
    .in("key", Object.keys(LEGACY_SETTINGS_KEYS));
  const profile: CompanyProfile = { ...EMPTY_PROFILE, trades: [], areas: [] };
  for (const row of data ?? []) {
    const field = LEGACY_SETTINGS_KEYS[row.key as keyof typeof LEGACY_SETTINGS_KEYS];
    if (field) (profile[field] as string) = row.value ?? "";
  }
  return profile;
}

export async function loadCompanyProfile(supabase: SupabaseClient, userId: string): Promise<LoadedProfile> {
  const [{ data: row, error }, { data: areaRows, error: areaError }] = await Promise.all([
    supabase
      .from("company_profiles")
      .select("business_name, owner_name, phone, website, about, trades, services, years_experience, wanted_jobs, unwanted_jobs")
      .eq("user_id", userId)
      .maybeSingle<ProfileRow>(),
    supabase.from("client_service_areas").select("area_id, cities").eq("user_id", userId),
  ]);

  if (isNotMigrated(error) || isNotMigrated(areaError)) {
    return { profile: await loadLegacy(supabase, userId), migrated: false };
  }
  if (error) throw error;
  if (areaError) throw areaError;

  // Signed up after 0021 but saved the old form, or never saved at all.
  if (!row) {
    const legacy = await loadLegacy(supabase, userId);
    return {
      profile: { ...legacy, areas: (areaRows ?? []).map((a) => ({ areaId: a.area_id, cities: a.cities ?? [] })) },
      migrated: true,
    };
  }

  return {
    migrated: true,
    profile: {
      businessName: row.business_name ?? "",
      ownerName: row.owner_name ?? "",
      phone: row.phone ?? "",
      website: row.website ?? "",
      about: row.about ?? "",
      trades: row.trades ?? [],
      services: row.services ?? "",
      yearsExperience: row.years_experience,
      wantedJobs: row.wanted_jobs ?? "",
      unwantedJobs: row.unwanted_jobs ?? "",
      areas: (areaRows ?? []).map((a) => ({ areaId: a.area_id, cities: a.cities ?? [] })),
    },
  };
}

/** For the AI routes: the profile as a prompt block, never throwing. */
export async function loadBusinessProfile(supabase: SupabaseClient, userId: string): Promise<BusinessProfile> {
  try {
    return toBusinessProfile((await loadCompanyProfile(supabase, userId)).profile);
  } catch {
    return toBusinessProfile(await loadLegacy(supabase, userId));
  }
}

/**
 * Saves a normalized profile. Always mirrors the four legacy settings keys.
 * Returns migrated: false when only those could be saved.
 */
export async function saveCompanyProfile(
  supabase: SupabaseClient,
  userId: string,
  p: CompanyProfile
): Promise<{ migrated: boolean }> {
  const legacyRows = Object.entries(LEGACY_SETTINGS_KEYS).map(([key, field]) => ({
    user_id: userId,
    key,
    value: p[field] as string,
  }));
  const { error: legacyError } = await supabase.from("settings").upsert(legacyRows, { onConflict: "user_id,key" });
  if (legacyError) throw legacyError;

  const { error } = await supabase.from("company_profiles").upsert(
    {
      user_id: userId,
      business_name: p.businessName || null,
      owner_name: p.ownerName || null,
      phone: p.phone || null,
      website: p.website || null,
      about: p.about || null,
      trades: p.trades,
      services: p.services || null,
      years_experience: p.yearsExperience,
      wanted_jobs: p.wantedJobs || null,
      unwanted_jobs: p.unwantedJobs || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (isNotMigrated(error)) return { migrated: false };
  if (error) throw error;

  // Replace the area list: delete what was dropped, upsert what is kept.
  const { data: existing, error: readError } = await supabase
    .from("client_service_areas")
    .select("area_id")
    .eq("user_id", userId);
  if (readError) throw readError;
  const keep = new Set(p.areas.map((a) => a.areaId));
  const dropped = (existing ?? []).map((r) => r.area_id as string).filter((id) => !keep.has(id));
  if (dropped.length) {
    const { error: delError } = await supabase
      .from("client_service_areas")
      .delete()
      .eq("user_id", userId)
      .in("area_id", dropped);
    if (delError) throw delError;
  }
  if (p.areas.length) {
    const { error: upError } = await supabase.from("client_service_areas").upsert(
      p.areas.map((a) => ({ user_id: userId, area_id: a.areaId, cities: a.cities })),
      { onConflict: "user_id,area_id" }
    );
    if (upError) throw upError;
  }
  return { migrated: true };
}

/** The area list for forms: the database copy when 0021 is applied, else the code's. */
export async function loadServiceAreas(supabase: SupabaseClient): Promise<ServiceArea[]> {
  const { data, error } = await supabase
    .from("service_areas")
    .select("id, name, country, cities")
    .eq("active", true)
    .order("country")
    .order("name");
  if (error || !data || data.length === 0) return [...SERVICE_AREAS];
  return data.map((a) => ({ id: a.id, name: a.name, country: a.country, cities: a.cities ?? [] }));
}
