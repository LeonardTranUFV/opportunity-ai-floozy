export type SortOption = "relevance" | "newest" | "oldest" | "urgency" | "platform"

/**
 * Newest first, because the worker adds leads every few hours. Sorted by match,
 * a fresh lead scoring 80 sank below hundreds of older 90–100s and the list
 * looked like nothing new had arrived.
 *
 * Lives here rather than in filter-bar.tsx: that file is "use client", and a
 * plain value imported from a client module into a server component arrives as
 * a client reference, not the string — the page silently fell back to its
 * relevance ordering.
 */
export const DEFAULT_SORT: SortOption = "newest"
