import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { SourceGuideCard } from "@/components/guide/source-guide-card"
import { FacebookIcon, LinkedInIcon, NextdoorIcon, XIcon, RedditIcon } from "@/components/icons"
import { KeyRound, Compass, Users, ListTodo, Briefcase, Sparkles } from "lucide-react"

const PIPELINE = [
  {
    icon: KeyRound,
    title: "Connect Accounts",
    description: "Log into Facebook, LinkedIn, Nextdoor, or X so the app can see what you see. A real browser window opens — you log in yourself, nothing is stored.",
    href: "/accounts",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/20",
  },
  {
    icon: Compass,
    title: "Add Sources",
    description: "Tell it which groups, your neighborhood, or search terms to watch. This is where you tell the app where to look.",
    href: "/communities",
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/20",
  },
  {
    icon: Users,
    title: "Create an AI Agent",
    description: "Describe what you're looking for in plain language — the AI turns it into a search profile and scores every post against it.",
    href: "/agents",
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-500/10",
    ring: "ring-violet-500/20",
  },
  {
    icon: ListTodo,
    title: "Review Opportunities",
    description: "See AI-scored leads with a suggested comment and DM already drafted for you — read it, tweak it if you want, send it.",
    href: "/opportunities",
    color: "text-rose-600 dark:text-rose-400",
    bg: "bg-rose-500/10",
    ring: "ring-rose-500/20",
  },
  {
    icon: Briefcase,
    title: "Track in CRM",
    description: "Move leads through your pipeline once you've made contact — from first reply to closed deal.",
    href: "/crm",
    color: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-500/10",
    ring: "ring-cyan-500/20",
  },
]

export default function GuidePage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">How It Works</h2>
        <p className="text-muted-foreground">
          A quick guide to connecting your accounts, adding sources, and turning posts into real leads.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" />
            The 5-step pipeline
          </CardTitle>
          <CardDescription>Do these in order the first time — after that, the AI keeps running on its own.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col">
            {PIPELINE.map((step, i) => (
              <li key={step.title} className="relative flex gap-4 pb-8 last:pb-0">
                {i < PIPELINE.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-5 top-11 h-[calc(100%-2rem)] w-px bg-gradient-to-b from-border to-transparent"
                  />
                )}
                <span
                  className={`relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full ${step.bg} ring-4 ring-background`}
                >
                  <step.icon className={`h-4.5 w-4.5 ${step.color}`} />
                </span>
                <a
                  href={step.href}
                  className={`group flex flex-1 flex-col gap-1 rounded-lg p-2.5 -m-2.5 transition-colors hover:bg-muted/50`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold uppercase tracking-wide ${step.color}`}>Step {i + 1}</span>
                  </div>
                  <span className="font-medium leading-tight group-hover:underline decoration-dotted underline-offset-4">
                    {step.title}
                  </span>
                  <span className="text-sm text-muted-foreground">{step.description}</span>
                </a>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold">Platform connectors</h3>
        <p className="text-sm text-muted-foreground">What each source does, and how to set it up.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SourceGuideCard
          icon={<FacebookIcon className="h-4.5 w-4.5" />}
          iconColor="bg-[#1877F2]/10 text-[#1877F2]"
          accentColor="border-t-[#1877F2]"
          tag="Connector"
          title="Facebook Groups"
          description="Scrape posts from Facebook groups you're a member of, looking for people who need what you offer."
          steps={[
            "Go to Connect Accounts and click Connect Facebook — a real browser window opens, you log in yourself.",
            "Close that popup window once you're logged in (don't leave it open, or it'll block future checks/logins).",
            "Go to Communities → Add a Source → Facebook, paste a group URL and give it a name. Or use Discover Facebook Groups to search by industry + location.",
            "Run Scan on an AI Agent to pull fresh posts and score them.",
          ]}
          caveat="Commenting on a post requires your account to already be a member of that group — Facebook won't let you comment otherwise."
          useNowHref="/accounts"
          defaultOpen
        />

        <SourceGuideCard
          icon={<LinkedInIcon className="h-4.5 w-4.5" />}
          iconColor="bg-[#0A66C2]/10 text-[#0A66C2]"
          accentColor="border-t-[#0A66C2]"
          tag="Connector"
          title="LinkedIn"
          description="Monitor LinkedIn feeds and search results for professionals posting about a need in your space."
          steps={[
            "Go to Connect Accounts and click Connect LinkedIn — log in yourself in the popup window.",
            "Close the popup once logged in.",
            "Go to Communities → Add a Source → LinkedIn and paste a feed or search-results URL.",
          ]}
          useNowHref="/accounts"
        />

        <SourceGuideCard
          icon={<NextdoorIcon className="h-4.5 w-4.5" />}
          iconColor="bg-[#8fca43]/10 text-[#8fca43]"
          accentColor="border-t-[#8fca43]"
          tag="Connector"
          title="Nextdoor"
          description="Watch your own verified neighborhood feed for local job requests — the highest-intent, most local source there is."
          steps={[
            "Go to Connect Accounts and click Connect Nextdoor. Use your email + password, not \"Continue with Google\" — Google blocks sign-in from any automated browser.",
            "Close the popup once logged in.",
            "Go to Communities → Add a Source → Nextdoor and click Add My Neighborhood — one click, no typing.",
          ]}
          caveat="Nextdoor only shows content for neighborhoods verified to your address — there's no way to browse other areas without real presence there."
          useNowHref="/accounts"
        />

        <SourceGuideCard
          icon={<XIcon className="h-4.5 w-4.5" />}
          iconColor="bg-foreground/10 text-foreground"
          accentColor="border-t-foreground/60"
          tag="Connector"
          title="X (Twitter)"
          description="Search X in real time for people publicly asking for your kind of service — not geofenced like Nextdoor, so it can cover a whole region."
          steps={[
            "Go to Connect Accounts and click Connect X — log in yourself in the popup window.",
            "Close the popup once logged in.",
            "Go to Communities → Add a Source → X and type what you're looking for, e.g. \"plumber recommendation Vancouver\" — the search link is built for you.",
          ]}
          useNowHref="/accounts"
        />

        <SourceGuideCard
          icon={<RedditIcon className="h-4.5 w-4.5" />}
          iconColor="bg-orange-600/10 text-orange-600"
          accentColor="border-t-orange-600"
          tag="Connector"
          title="Reddit"
          description="Watch specific subreddits or search all of Reddit by keyword. Uses a free Reddit developer app, not your personal login."
          steps={[
            "Reddit locked down unauthenticated API access in 2023 — a free \"script\" app at reddit.com/prefs/apps is required (no Reddit password shared with this app, just a client ID/secret).",
            "Go to Communities → Add a Source → Reddit and type what you're looking for, e.g. \"need a roofer Vancouver\" to search all of Reddit.",
            "Or click \"Or watch a specific subreddit\" and enter just the name, e.g. \"roofing\", to follow one subreddit's new posts.",
          ]}
          caveat="Backend wiring for the Reddit API is still in progress — sources can be added now, but scraping won't return real posts until that's finished."
          useNowHref="/communities"
        />

        <SourceGuideCard
          icon={<span className="text-sm font-bold">📷</span>}
          iconColor="bg-purple-500/10 text-purple-600 dark:text-purple-400"
          accentColor="border-t-purple-500"
          tag="Tool"
          title="Screenshot-to-Lead"
          description="Paste a screenshot of a post from anywhere — even a platform or area you can't scrape directly — and let AI extract the lead."
          steps={[]}
          useNowHref="/opportunities"
          comingSoon
        />
      </div>
    </div>
  )
}
