/**
 * Starting points for a new agent, one per trade we actually serve.
 *
 * These exist because the blank textarea on step 1 is where zero-result agents
 * are born, and the difference between an agent that works and one that
 * returns nothing is not effort — it is keyword shape. Measured across this
 * deployment's four agents:
 *
 *   Contractor          `Roof, Contractor, floor, building, leak, plumber`   705 kept
 *   Flooring Scout      `floor remodel, hardwood refinishing, need flooring`   0 kept
 *   Eminant             (no keywords at all)                                   0 kept
 *   Legacy Import       (no keywords at all)                                   0 kept
 *
 * The one that works uses **short broad stems**. The one that doesn't uses
 * multi-word phrases — and "hardwood refinishing" is simply not how somebody
 * types when their floor is ruined and they want it fixed. They write "my
 * floor is wrecked, anyone know a guy". A stem catches that; a phrase cannot.
 *
 * So every template below is stems, and every one is deliberately broader than
 * feels comfortable. Over-matching is cheap — the AI scores each post against
 * the goal afterwards and throws out what doesn't fit. Under-matching is not
 * recoverable, because a post the keywords never surfaced is a post the
 * scoring never sees.
 *
 * **No template ships negative keywords.** They are the single largest cause
 * of an agent that scores hundreds of posts and keeps none: this deployment's
 * Flooring Scout rejected most of a contractor group's feed on "hiring" and
 * "looking for job" before the flooring filter ever ran, because those words
 * appear constantly in trade groups for reasons that have nothing to do with
 * the poster's intent. They stay available as a field for someone who has read
 * their own results and knows what they want gone.
 */

export interface AgentTemplate {
  id: string;
  /** Shown on the picker button. */
  icon: string;
  label: string;
  /** Prefills the agent name; the user can rename it. */
  name: string;
  /** First person, because the scoring prompt reads it as the operator's intent. */
  goal: string;
  keywords: string;
}

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: "general-contractor",
    icon: "🔨",
    label: "General contractor",
    name: "Contractor Scout",
    goal: "I'm a general contractor. I want to find homeowners who need renovation, repair or building work done, or who are asking for a contractor recommendation.",
    keywords: "contractor, renovation, remodel, reno, drywall, framing, basement, permit, build, repair",
  },
  {
    id: "roofing",
    icon: "🏠",
    label: "Roofing",
    name: "Roofing Scout",
    goal: "I'm a roofer. I want to find homeowners with roof leaks, storm damage, missing shingles, or who need a roof replaced or inspected.",
    keywords: "roof, roofer, shingle, leak, gutter, attic, skylight, flashing",
  },
  {
    id: "plumbing",
    icon: "🚿",
    label: "Plumbing",
    name: "Plumbing Scout",
    goal: "I'm a plumber. I want to find people with leaking pipes, blocked drains, broken water heaters, or any plumbing emergency.",
    keywords: "plumber, plumbing, leak, drain, pipe, clog, toilet, faucet, sewer, water heater",
  },
  {
    id: "hvac",
    icon: "🌡️",
    label: "HVAC",
    name: "HVAC Scout",
    goal: "I do heating and cooling. I want to find people whose furnace or air conditioning has failed, or who need a system serviced or replaced.",
    keywords: "hvac, furnace, heating, cooling, ac, duct, thermostat, boiler, heat pump, vent",
  },
  {
    id: "electrical",
    icon: "⚡",
    label: "Electrical",
    name: "Electrical Scout",
    goal: "I'm an electrician. I want to find people who need wiring, panel upgrades, lighting installed, or who have an electrical fault.",
    keywords: "electrician, electrical, wiring, panel, outlet, breaker, lighting, rewire, generator",
  },
  {
    id: "flooring",
    icon: "🪵",
    label: "Flooring",
    name: "Flooring Scout",
    goal: "I install and refinish floors. I want to find homeowners replacing, repairing or refinishing flooring of any kind.",
    keywords: "floor, flooring, hardwood, laminate, tile, carpet, vinyl, subfloor, refinish",
  },
  {
    id: "cleaning",
    icon: "🧽",
    label: "Cleaning",
    name: "Cleaning Scout",
    goal: "I run a cleaning company. I want to find people looking for house cleaning, move-out cleaning, or regular housekeeping.",
    keywords: "cleaning, cleaner, housekeeping, maid, janitorial, tidy, declutter, carpet clean",
  },
  {
    id: "landscaping",
    icon: "🌿",
    label: "Landscaping",
    name: "Landscaping Scout",
    goal: "I do landscaping and yard work. I want to find people who need lawn care, tree work, hedges, fencing or garden design.",
    keywords: "landscaping, lawn, yard, garden, hedge, tree, sod, irrigation, fence, mowing",
  },
  {
    id: "moving",
    icon: "📦",
    label: "Moving",
    name: "Moving Scout",
    goal: "I run a moving company. I want to find people who are moving house or office and need movers, a truck, or help hauling things away.",
    keywords: "mover, movers, moving, haul, hauling, truck, packing, storage, junk removal",
  },
  {
    id: "beauty",
    icon: "💅",
    label: "Nails & beauty",
    name: "Salon Scout",
    goal: "I run a nail and beauty salon. I want to find people asking for a nail tech, lash artist, or salon recommendation in my area.",
    keywords: "nail, nails, manicure, pedicure, salon, lash, brow, waxing, spa, tech",
  },
] as const;

export function findAgentTemplate(id: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.id === id);
}
