/**
 * A hand-curated proximity map (no geocoding API, no cost) so picking one
 * city suggests its natural metro area instead of making someone type out
 * every neighbouring municipality by hand.
 *
 * This was scoped to British Columbia, where the first customers were. The
 * product now sells across Canada and the United States, and the location
 * step promised "nearby areas get suggested automatically" to a Toronto or
 * Houston contractor who got an empty list and a text box. Every major metro
 * in both countries is here now. A city not on the list still works — the
 * picker accepts anything typed — it just gets no neighbours suggested.
 *
 * Clusters are commuting areas, not counties: the municipalities whose
 * homeowners would plausibly hire the same roofer. Keep them to places a
 * local would recognise by name.
 */
export const CITY_CLUSTERS: { region: string; cities: string[] }[] = [
  // ── Canada ────────────────────────────────────────────────────────────────
  {
    region: "Metro Vancouver",
    cities: [
      "Vancouver", "Burnaby", "Richmond", "Surrey", "Coquitlam", "Port Coquitlam",
      "Port Moody", "New Westminster", "North Vancouver", "West Vancouver", "Delta",
      "Langley", "Maple Ridge", "White Rock",
    ],
  },
  { region: "Vancouver Island", cities: ["Victoria", "Saanich", "Nanaimo", "Langford", "Colwood"] },
  { region: "Fraser Valley", cities: ["Abbotsford", "Chilliwack", "Mission"] },
  { region: "Okanagan", cities: ["Kelowna", "West Kelowna", "Kamloops", "Vernon", "Penticton"] },
  { region: "Northern BC", cities: ["Prince George"] },
  {
    region: "Calgary",
    cities: ["Calgary", "Airdrie", "Cochrane", "Okotoks", "Chestermere"],
  },
  {
    region: "Edmonton",
    cities: ["Edmonton", "St. Albert", "Sherwood Park", "Spruce Grove", "Leduc", "Fort Saskatchewan"],
  },
  { region: "Saskatchewan", cities: ["Saskatoon", "Regina"] },
  { region: "Winnipeg", cities: ["Winnipeg", "Steinbach"] },
  {
    region: "Greater Toronto",
    cities: [
      "Toronto", "Mississauga", "Brampton", "Vaughan", "Markham", "Richmond Hill",
      "Oakville", "Burlington", "Milton", "Pickering", "Ajax", "Whitby", "Oshawa",
      "Newmarket", "Aurora",
    ],
  },
  { region: "Hamilton–Niagara", cities: ["Hamilton", "St. Catharines", "Niagara Falls", "Grimsby"] },
  { region: "Waterloo Region", cities: ["Kitchener", "Waterloo", "Cambridge", "Guelph"] },
  { region: "London, Ontario", cities: ["London", "St. Thomas", "Strathroy"] },
  { region: "Ottawa–Gatineau", cities: ["Ottawa", "Gatineau", "Kanata", "Orléans", "Nepean"] },
  {
    region: "Greater Montréal",
    cities: ["Montréal", "Laval", "Longueuil", "Brossard", "Terrebonne", "Repentigny", "Saint-Jérôme"],
  },
  { region: "Québec City", cities: ["Québec City", "Lévis"] },
  { region: "Halifax", cities: ["Halifax", "Dartmouth", "Bedford"] },
  { region: "Moncton", cities: ["Moncton", "Dieppe", "Riverview"] },

  // ── United States ─────────────────────────────────────────────────────────
  {
    region: "Seattle–Tacoma",
    cities: ["Seattle", "Bellevue", "Tacoma", "Everett", "Kent", "Renton", "Kirkland", "Redmond"],
  },
  { region: "Portland", cities: ["Portland", "Beaverton", "Hillsboro", "Gresham", "Vancouver WA"] },
  {
    region: "San Francisco Bay Area",
    cities: ["San Francisco", "Oakland", "San Jose", "Fremont", "Berkeley", "Sunnyvale", "Santa Clara", "Hayward"],
  },
  { region: "Sacramento", cities: ["Sacramento", "Roseville", "Elk Grove", "Folsom"] },
  {
    region: "Los Angeles",
    cities: ["Los Angeles", "Long Beach", "Pasadena", "Glendale", "Burbank", "Torrance", "Santa Monica", "Inglewood"],
  },
  { region: "Orange County", cities: ["Anaheim", "Irvine", "Santa Ana", "Huntington Beach", "Orange", "Fullerton"] },
  { region: "Inland Empire", cities: ["Riverside", "San Bernardino", "Ontario", "Rancho Cucamonga", "Corona", "Temecula"] },
  { region: "San Diego", cities: ["San Diego", "Chula Vista", "Oceanside", "Escondido", "Carlsbad", "El Cajon"] },
  { region: "Las Vegas", cities: ["Las Vegas", "Henderson", "North Las Vegas", "Summerlin"] },
  {
    region: "Phoenix",
    cities: ["Phoenix", "Mesa", "Scottsdale", "Chandler", "Gilbert", "Glendale AZ", "Tempe", "Peoria"],
  },
  { region: "Denver", cities: ["Denver", "Aurora", "Lakewood", "Arvada", "Westminster", "Littleton", "Boulder"] },
  { region: "Salt Lake City", cities: ["Salt Lake City", "West Valley City", "Sandy", "Provo", "Ogden"] },
  {
    region: "Dallas–Fort Worth",
    cities: ["Dallas", "Fort Worth", "Arlington", "Plano", "Irving", "Frisco", "McKinney", "Garland", "Denton"],
  },
  {
    region: "Houston",
    cities: ["Houston", "Sugar Land", "Pearland", "The Woodlands", "Katy", "Pasadena TX", "League City", "Cypress"],
  },
  { region: "Austin", cities: ["Austin", "Round Rock", "Cedar Park", "Georgetown", "Pflugerville"] },
  { region: "San Antonio", cities: ["San Antonio", "New Braunfels", "Schertz"] },
  {
    region: "Minneapolis–St. Paul",
    cities: ["Minneapolis", "St. Paul", "Bloomington", "Plymouth", "Eden Prairie", "Maple Grove"],
  },
  {
    region: "Chicago",
    cities: ["Chicago", "Naperville", "Aurora IL", "Joliet", "Evanston", "Schaumburg", "Oak Park", "Elgin"],
  },
  { region: "Detroit", cities: ["Detroit", "Dearborn", "Livonia", "Troy", "Warren", "Sterling Heights", "Ann Arbor"] },
  { region: "Columbus", cities: ["Columbus", "Dublin", "Westerville", "Hilliard", "Grove City"] },
  { region: "Cleveland", cities: ["Cleveland", "Parma", "Lakewood OH", "Akron"] },
  { region: "Indianapolis", cities: ["Indianapolis", "Carmel", "Fishers", "Greenwood", "Noblesville"] },
  { region: "Nashville", cities: ["Nashville", "Franklin", "Murfreesboro", "Hendersonville", "Brentwood"] },
  { region: "Atlanta", cities: ["Atlanta", "Marietta", "Alpharetta", "Sandy Springs", "Roswell", "Decatur", "Lawrenceville"] },
  { region: "Charlotte", cities: ["Charlotte", "Concord", "Gastonia", "Huntersville", "Matthews"] },
  { region: "Raleigh–Durham", cities: ["Raleigh", "Durham", "Cary", "Chapel Hill", "Apex"] },
  { region: "Tampa Bay", cities: ["Tampa", "St. Petersburg", "Clearwater", "Brandon", "Largo"] },
  { region: "Orlando", cities: ["Orlando", "Kissimmee", "Sanford", "Winter Park", "Apopka"] },
  {
    region: "South Florida",
    cities: ["Miami", "Fort Lauderdale", "Hollywood", "Boca Raton", "West Palm Beach", "Coral Springs", "Pembroke Pines"],
  },
  { region: "Jacksonville", cities: ["Jacksonville", "Orange Park", "St. Augustine"] },
  {
    region: "Washington, DC",
    cities: ["Washington", "Arlington VA", "Alexandria", "Bethesda", "Silver Spring", "Fairfax", "Rockville"],
  },
  { region: "Baltimore", cities: ["Baltimore", "Towson", "Columbia MD", "Glen Burnie"] },
  {
    region: "Philadelphia",
    cities: ["Philadelphia", "Cherry Hill", "Camden", "King of Prussia", "Norristown", "Wilmington"],
  },
  { region: "Pittsburgh", cities: ["Pittsburgh", "Cranberry Township", "Monroeville", "Bethel Park"] },
  {
    region: "New York City",
    cities: ["New York", "Brooklyn", "Queens", "The Bronx", "Staten Island", "Yonkers", "Jersey City", "Newark", "Hoboken"],
  },
  { region: "Long Island", cities: ["Hempstead", "Huntington", "Islip", "Brookhaven", "Oyster Bay"] },
  { region: "Boston", cities: ["Boston", "Cambridge MA", "Somerville", "Quincy", "Newton", "Brookline", "Waltham"] },
];

export function clusterFor(city: string): string[] {
  const found = CITY_CLUSTERS.find((c) => c.cities.some((x) => x.toLowerCase() === city.toLowerCase()))
  return found ? found.cities : []
}

export const ALL_CITIES = CITY_CLUSTERS.flatMap((c) => c.cities)
