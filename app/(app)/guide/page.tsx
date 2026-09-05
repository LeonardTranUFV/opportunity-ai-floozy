import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { SourceGuideCard } from "@/components/guide/source-guide-card"
import { WalkthroughVideo } from "@/components/guide/walkthrough-video"
import { StartTourButton } from "@/components/tour/start-tour-button"
import { FacebookIcon, LinkedInIcon, NextdoorIcon, XIcon, RedditIcon } from "@/components/icons"
import { KeyRound, Compass, Users, ListTodo, Briefcase, Sparkles } from "lucide-react"

// Drop an embed URL here when the walkthrough video is ready (YouTube/Vimeo/
// Loom embed link, or a direct file URL) — the placeholder swaps out on its own.
const WALKTHROUGH_VIDEO_URL: string | undefined = undefined

const PIPELINE = [
  {
    icon: KeyRound,
    title: "Connect Accounts",
    description: "Sign into Facebook, LinkedIn, Nextdoor or X so the app can see what you see. A browser opens inside this page and you sign in yourself — we never see your password, and the sign-in is saved so you only do it once.",
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

      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gradient-to-r from-brand/[0.07] to-transparent bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-heading text-sm font-medium">Take the guided tour</span>
          <span className="text-sm text-muted-foreground">
            Walks you through the app and points at each button as you go — about two minutes.
          </span>
        </div>
        <StartTourButton />
      </div>

      <WalkthroughVideo videoUrl={WALKTHROUGH_VIDEO_URL} />

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
          description="Watch Facebook groups for people who need what you offer. Public groups work without joining; private ones need you to be a member."
          steps={[
            "Go to Connect Accounts and click Connect Facebook — a browser opens inside the page and you sign in there yourself.",
            "Expect a security email from Facebook saying a new browser signed in. That's this, and it's normal.",
            "Click \"I've logged in\" when you're through. Your sign-in is saved, encrypted, so you won't be asked again.",
            "Go to Sources → Find groups to monitor, enter your trade and area, and Track the ones you want. Not sure what to search for? Open the AI suggestions. You can also paste a group URL under Add a Source.",
            "Join the groups you want to reply in — tracking collects the leads, membership is what lets you answer them.",
            "Hit Find Opportunities on an AI Agent — it collects the newest posts and scores them for you.",
          ]}
          caveat="Reading and replying are different things. A public group collects posts the moment you track it, no membership needed — but Facebook only lets members comment. The app will still find the lead and write your reply; you just can't send it until you've joined. Private groups collect nothing until your join request is approved."
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
            "Go to Sources → Add a Source → LinkedIn and paste a feed or search-results URL.",
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
            "Go to Connect Accounts and click Connect Nextdoor. Use your email and password, not \"Continue with Google\" — Google refuses sign-in from an automated browser.",
            "Close the popup once logged in.",
            "Go to Sources → Add a Source → Nextdoor and click Add My Neighborhood — one click, no typing.",
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
            "Go to Sources → Add a Source → X and type what you're looking for, e.g. \"plumber recommendation Vancouver\" — the search link is built for you.",
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
            "Go to Sources → Add a Source → Reddit and type what you're looking for, e.g. \"need a roofer Vancouver\" to search all of Reddit.",
            "Or click \"Or watch a specific subreddit\" and enter just the name, e.g. \"roofing\", to follow one subreddit's new posts.",
          ]}
          caveat="The app's Reddit support is finished and works — what it needs is API credentials. Reddit closed new Data API registrations to anything that isn't a moderation tool, so a new script app has to be approved by them first. Until this deployment has credentials, Reddit sources can be added but collect nothing."
          useNowHref="/communities"
        />

        <SourceGuideCard
          icon={<span className="text-sm font-bold">📷</span>}
          iconColor="bg-purple-500/10 text-purple-600 dark:text-purple-400"
          accentColor="border-t-purple-500"
          tag="Tool"
          title="Screenshot-to-Lead"
          description="Paste a screenshot of a post from anywhere — even a platform or area the app can't reach directly — and let AI extract the lead."
          steps={[]}
          useNowHref="/opportunities"
          comingSoon
        />
      </div>
    </div>
  )
}
