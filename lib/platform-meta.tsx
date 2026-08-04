import { Store as StoreIcon } from "lucide-react"
import { FacebookIcon, LinkedInIcon, NextdoorIcon, XIcon, RedditIcon } from "@/components/icons"

export interface PlatformMeta {
  label: string
  Icon: typeof FacebookIcon
  iconColor: string
}

export const PLATFORM_META: Record<string, PlatformMeta> = {
  facebook: { label: "Facebook", Icon: FacebookIcon, iconColor: "bg-[#1877F2]/10 text-[#1877F2]" },
  marketplace: { label: "Marketplace", Icon: StoreIcon as typeof FacebookIcon, iconColor: "bg-[#1877F2]/10 text-[#1877F2]" },
  linkedin: { label: "LinkedIn", Icon: LinkedInIcon, iconColor: "bg-[#0A66C2]/10 text-[#0A66C2]" },
  nextdoor: { label: "Nextdoor", Icon: NextdoorIcon, iconColor: "bg-[#8fca43]/10 text-[#8fca43]" },
  twitter: { label: "X", Icon: XIcon, iconColor: "bg-foreground/10 text-foreground" },
  reddit: { label: "Reddit", Icon: RedditIcon, iconColor: "bg-orange-600/10 text-orange-600" },
}

export const PLATFORM_ORDER = ["facebook", "marketplace", "linkedin", "nextdoor", "twitter", "reddit"]

export function platformMeta(platform: string): PlatformMeta {
  return PLATFORM_META[platform] ?? { label: platform, Icon: FacebookIcon, iconColor: "bg-muted text-muted-foreground" }
}
