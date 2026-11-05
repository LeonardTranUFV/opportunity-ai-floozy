/**
 * Service areas: the places Floozy collects leads in, and the places a client
 * says they work.
 *
 * One area per commuting cluster in lib/nearby-cities.ts, so "Burnaby" and
 * "Surrey" land in the same area and one set of Facebook groups serves every
 * client there. The database table `service_areas` (migration 0021) is seeded
 * from this list; `npm run check` fails if the two drift apart.
 *
 * The slug is the area's id everywhere (database, URLs, matcher). Changing a
 * region's name changes its slug, so add a new area rather than renaming one
 * that clients have already picked.
 */
import { CITY_CLUSTERS } from "@/lib/nearby-cities";

export interface ServiceArea {
  id: string;
  name: string;
  country: "CA" | "US";
  cities: string[];
}

/** "Greater Montréal" -> "greater-montreal", "Washington, DC" -> "washington-dc". */
export function areaSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const SERVICE_AREAS: readonly ServiceArea[] = CITY_CLUSTERS.map((c) => ({
  id: areaSlug(c.region),
  name: c.region,
  country: c.country,
  cities: [...c.cities],
}));

export function findServiceArea(id: string, areas: readonly ServiceArea[] = SERVICE_AREAS): ServiceArea | undefined {
  return areas.find((a) => a.id === id);
}

/** The area a city belongs to, by exact (case-insensitive) name. */
export function areaForCity(city: string, areas: readonly ServiceArea[] = SERVICE_AREAS): ServiceArea | undefined {
  const wanted = city.trim().toLowerCase();
  if (!wanted) return undefined;
  return areas.find((a) => a.cities.some((c) => c.toLowerCase() === wanted));
}

/**
 * A client's pick inside one area. Empty `cities` means the whole area, so a
 * client who works everywhere in Metro Vancouver does not have to tick 14 boxes,
 * and a city added to the area later is included for them automatically.
 */
export interface AreaChoice {
  areaId: string;
  cities: string[];
}

/** Does this choice cover a post from `city` in `areaId`? A post with no known city matches the whole area. */
export function choiceCovers(choice: AreaChoice, areaId: string, city?: string | null): boolean {
  if (choice.areaId !== areaId) return false;
  if (choice.cities.length === 0 || !city) return true;
  const wanted = city.trim().toLowerCase();
  return choice.cities.some((c) => c.toLowerCase() === wanted);
}

/** SQL seed rows for migration 0021, kept here so the check can compare them. */
export function serviceAreaSeedSql(areas: readonly ServiceArea[] = SERVICE_AREAS): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const rows = areas.map(
    (a) => `  (${q(a.id)}, ${q(a.name)}, ${q(a.country)}, array[${a.cities.map(q).join(", ")}])`
  );
  return rows.join(",\n");
}
