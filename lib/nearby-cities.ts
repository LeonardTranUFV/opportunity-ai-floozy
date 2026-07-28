/**
 * A lightweight, hand-curated proximity map (no geocoding API/cost) so
 * picking one city can suggest its natural metro area instead of making
 * users type out every neighboring city by hand. Scoped to BC, where the
 * business currently operates — add more regions here as coverage expands.
 */
export const CITY_CLUSTERS: { region: string; cities: string[] }[] = [
  {
    region: "Metro Vancouver",
    cities: [
      "Vancouver",
      "Burnaby",
      "Richmond",
      "Surrey",
      "Coquitlam",
      "Port Coquitlam",
      "Port Moody",
      "New Westminster",
      "North Vancouver",
      "West Vancouver",
      "Delta",
      "Langley",
      "Maple Ridge",
      "White Rock",
    ],
  },
  {
    region: "Vancouver Island",
    cities: ["Victoria", "Saanich", "Nanaimo", "Langford", "Colwood"],
  },
  {
    region: "Fraser Valley",
    cities: ["Abbotsford", "Chilliwack", "Mission"],
  },
  {
    region: "Okanagan",
    cities: ["Kelowna", "Kamloops", "Vernon"],
  },
  {
    region: "Northern BC",
    cities: ["Prince George"],
  },
]

export function clusterFor(city: string): string[] {
  const found = CITY_CLUSTERS.find((c) => c.cities.some((x) => x.toLowerCase() === city.toLowerCase()))
  return found ? found.cities : []
}

export const ALL_CITIES = CITY_CLUSTERS.flatMap((c) => c.cities)
