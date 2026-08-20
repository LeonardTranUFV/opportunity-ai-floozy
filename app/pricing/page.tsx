import Link from "next/link"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"

// Title carries no product suffix — the root layout's template appends it.
export const metadata = {
  title: "Pricing",
  description:
    "Opportunity AI watches Reddit, Facebook, LinkedIn and Nextdoor for people asking for your trade nearby, and scores which ones are worth calling first. Reddit starts the moment you sign up; we connect the rest with you. Credit-based plans, 7-day trial.",
  alternates: { canonical: "/pricing" },
}

const STARTER_LINK = "https://buy.stripe.com/fZu9ALdvneGd0Ym17I5wI0g"
const PRO_LINK = "https://buy.stripe.com/14A8wH2QJ2XvbD05nY5wI0h"

const TIERS = [
  {
    name: "Free Trial",
    price: "$0",
    period: "7 days",
    tagline: "See real leads in your own market before you decide anything.",
    cta: "Start free trial",
    href: "/login",
    variant: "outline" as const,
    features: [
      "7 days, or your first 5–10 qualified leads — whichever comes first",
      "1 agent watching Reddit — live the moment you sign up",
      "We connect Facebook, LinkedIn or Nextdoor with you, and run your onboarding scan",
      "No credit card required",
    ],
  },
  {
    name: "Starter",
    price: "$97",
    period: "/month",
    tagline: "For one trade, one city, steady inbound.",
    cta: "Get Starter",
    href: STARTER_LINK,
    variant: "outline" as const,
    features: [
      "1 agent",
      "Reddit, plus up to 2 platforms we connect with you",
      "Manual scans on request",
      "Email support",
    ],
  },
  {
    name: "Pro",
    price: "$197",
    period: "/month",
    tagline: "For teams covering more ground, faster.",
    cta: "Get Pro",
    href: PRO_LINK,
    variant: "brand" as const,
    highlighted: true,
    features: [
      "Unlimited agents",
      "Every platform — Reddit, Facebook, LinkedIn, Nextdoor, X",
      "Hourly auto-scan, no manual runs",
      "AI-drafted outreach messages",
      "Priority setup",
    ],
  },
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 shadow-sm shadow-blue-600/30">
            <span className="font-bold text-white">O</span>
          </div>
          <span className="font-semibold">Floozy Opportunity AI</span>
        </div>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/login" />}>
          Sign in
        </Button>
      </header>

      <section className="mx-auto max-w-3xl px-6 pt-10 pb-16 text-center">
        <Badge variant="brand" className="mb-4">
          For trades &amp; local service businesses
        </Badge>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          See the leads before your competitors even look.
        </h1>
        <p className="mt-4 text-pretty text-lg text-muted-foreground">
          Floozy Opportunity AI watches Reddit, Facebook, LinkedIn and Nextdoor for people
          asking for a plumber, electrician, contractor — whatever you do — near you, and
          scores which ones are worth calling first.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            variant="brand"
            size="lg"
            nativeButton={false}
            render={<Link href="/login" />}
          >
            Start your free trial
          </Button>
          <Button
            variant="outline"
            size="lg"
            nativeButton={false}
            render={<a href="#pricing" />}
          >
            See pricing
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          7 days, or your first 5–10 qualified leads — whichever comes first. No
          credit card required.
        </p>
      </section>

      <section id="pricing" className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-6 sm:grid-cols-3">
          {TIERS.map((tier) => (
            <Card
              key={tier.name}
              className={
                tier.highlighted
                  ? "relative ring-2 ring-brand"
                  : "relative"
              }
            >
              {tier.highlighted && (
                <Badge
                  variant="brand"
                  className="absolute -top-2.5 left-1/2 -translate-x-1/2"
                >
                  Most popular
                </Badge>
              )}
              <CardHeader>
                <CardTitle className="text-lg">{tier.name}</CardTitle>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight">
                    {tier.price}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {tier.period}
                  </span>
                </div>
                <CardDescription className="mt-1">{tier.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="flex flex-col gap-2.5">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter className="!border-t-0 !bg-transparent pt-0">
                <Button
                  variant={tier.variant}
                  className="w-full"
                  nativeButton={false}
                  render={<Link href={tier.href} />}
                >
                  {tier.cta}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
        {/* The tiers used to promise Facebook, LinkedIn and Nextdoor as though a
            customer could switch them on themselves, and never mentioned Reddit —
            which is the one that actually does work that way. Reading those feeds
            means driving a signed-in browser session, so somebody on our side sets
            each one up with you. Saying so here costs a little polish and saves a
            customer paying for something they then can't turn on. */}
        <p className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground">
          Reddit runs itself — add a community and it starts collecting straight away.
          Facebook, LinkedIn, Nextdoor and X have to be signed in through a real browser
          session, so we set those up with you during onboarding rather than leaving you
          to connect them alone.
        </p>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          No contracts. Cancel anytime. Prices in CAD.
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          <Link href="/terms" className="underline decoration-dotted underline-offset-4 hover:text-foreground">
            Terms of Service
          </Link>
          {" · "}
          <Link href="/privacy" className="underline decoration-dotted underline-offset-4 hover:text-foreground">
            Privacy Policy
          </Link>
        </p>
      </section>
    </div>
  )
}
