import { Store as StoreIcon } from "lucide-react"
import { FacebookIcon, LinkedInIcon, NextdoorIcon, XIcon, RedditIcon } from "@/components/icons"

export interface PlatformMeta {
  label: string
  Icon: typeof FacebookIcon
  iconColor: string
  /**
   * Does collecting from this platform require the *customer* to sign in with
   * their own account?
   *
   * This is the first thing someone needs to know before choosing a source,
   * and it splits the platforms cleanly in two:
   *
   *   - Reddit reads through an application-only API token that belongs to us
   *     (lib/reddit-auth.ts). The customer never logs in, never opens Reddit,
   *     and results arrive the moment they sign up — which is why the free
   *     scan runs on Reddit alone.
   *   - Facebook, Marketplace, LinkedIn, Nextdoor and X all closed logged-out
   *     reads. There is no API and no header trick; the only way in is a real
   *     browser carrying that person's own session. Each one costs the
   *     customer a login before it returns anything.
   *
   * Nextdoor is the strictest of the five: an account there is tied to a
   * verified home address, so it reaches the neighbourhood someone lives in
   * rather than the service area they work in. Said out loud here because
   * otherwise it reads as the easy option when it is the hardest one.
   */
  needsAccount: boolean
  /** Shown beside the platform wherever a customer is picking sources. */
  setupNote: string
}

export const PLATFORM_META: Record<string, PlatformMeta> = {
  reddit: {
    label: "Reddit",
    Icon: RedditIcon,
    iconColor: "bg-orange-600/10 text-orange-600",
    needsAccount: false,
    setupNote: "Works straight away — no Reddit account, and you never have to open Reddit.",
  },
  facebook: {
    label: "Facebook",
    Icon: FacebookIcon,
    iconColor: "bg-[#1877F2]/10 text-[#1877F2]",
    needsAccount: true,
    setupNote: "Sign in once with your own Facebook account. About 2 minutes, and it multiplies what we find.",
  },
  marketplace: {
    label: "Marketplace",
    Icon: StoreIcon as typeof FacebookIcon,
    iconColor: "bg-[#1877F2]/10 text-[#1877F2]",
    needsAccount: true,
    setupNote: "Comes with Facebook — connect that once and this is included.",
  },
  linkedin: {
    label: "LinkedIn",
    Icon: LinkedInIcon,
    iconColor: "bg-[#0A66C2]/10 text-[#0A66C2]",
    needsAccount: true,
    setupNote: "Sign in once with your own LinkedIn account.",
  },
  nextdoor: {
    label: "Nextdoor",
    Icon: NextdoorIcon,
    iconColor: "bg-[#8fca43]/10 text-[#8fca43]",
    needsAccount: true,
    setupNote:
      "Sign in with your own Nextdoor account. Nextdoor verifies a home address, so it only reaches the neighbourhoods that account can see — not your whole service area.",
  },
  twitter: {
    label: "X",
    Icon: XIcon,
    iconColor: "bg-foreground/10 text-foreground",
    needsAccount: true,
    setupNote: "Sign in once with your own X account. X stopped showing search results to signed-out visitors.",
  },
}

/**
 * Reddit first, deliberately. It is the only source that returns something
 * before the customer has done any work, so it belongs at the top of every
 * list where someone is deciding what to connect.
 */
export const PLATFORM_ORDER = ["reddit", "facebook", "marketplace", "linkedin", "nextdoor", "twitter"]

export function platformMeta(platform: string): PlatformMeta {
  return (
    PLATFORM_META[platform] ?? {
      label: platform,
      Icon: FacebookIcon,
      iconColor: "bg-muted text-muted-foreground",
      needsAccount: true,
      setupNote: "",
    }
  )
}

/** Platforms that return results with no setup from the customer. */
export const INSTANT_PLATFORMS = PLATFORM_ORDER.filter((p) => !PLATFORM_META[p].needsAccount)
