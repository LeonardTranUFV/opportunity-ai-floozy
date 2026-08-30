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
    "See who near you has been asking for your trade in the last 90 days — free, no card, no account to connect. Then $49 a week or $149 a month, after a 3-day trial. Less than one shared lead from Angi or HomeStars.",
  alternates: { canonical: "/pricing" },
}

/**
 * Stripe Payment Links, both carrying a 3-day free trial and redirecting to
 * /welcome so the pixel can report the trial start.
 *
 * Prices are CAD because the Stripe account is Canadian; a US visitor sees the
 * CAD amount converted at checkout. Worth revisiting if US ends up the larger
 * half of spend — currency friction is small but it is not zero.
 *
 * The older $97 Starter and $197 Pro links still exist in Stripe and still
 * work; they are simply no longer offered here. Nothing is archived, so any
 * customer already on them keeps billing normally.
 */
const WEEKLY_LINK = "https://buy.stripe.com/6oUbITfDv1Tr5eC2bM5wI0i"
const MONTHLY_LINK = "https://buy.stripe.com/fZudR1gHzfKh0Ym4jU5wI0j"

/**
 * Three columns, and the first one is the whole pitch.
 *
 * The free scan is not a teaser tier — it is the product doing its job once,
 * for free, before anyone is asked for anything. Everything about the ordering
 * here follows from that: value first, card second.
 */
const TIERS = [
  {
    name: "Free scan",
    price: "$0",
    period: "no card",
    tagline: "See what you have been missing before you decide anything.",
    cta: "Run my free scan",
    href: "/login",
    variant: "outline" as const,
    features: [
      "Every request for your trade near you from the last 90 days",
      "Scored, so the ones worth calling first are at the top",
      "Nothing to connect — no Reddit, Facebook or Google account needed",
      "Results in about a minute",
    ],
  },
  {
    name: "Weekly",
    price: "$49",
    period: "/week",
    tagline: "Less than one shared lead from Angi or HomeStars.",
    cta: "Start 3-day trial",
    href: WEEKLY_LINK,
    variant: "outline" as const,
    features: [
      "New matches every day, emailed each morning",
      "3 days free, then $49 a week — cancel any time",
      "Connect Facebook, LinkedIn, Nextdoor or X for several times the volume",
      "AI-drafted first messages",
    ],
  },
  {
    name: "Monthly",
    price: "$149",
    period: "/month",
    tagline: "About two shared leads — except these are yours alone.",
    cta: "Start 3-day trial",
    href: MONTHLY_LINK,
    variant: "brand" as const,
    highlighted: true,
    features: [
      "Everything in Weekly, and $47 a month cheaper",
      "Unlimited agents — more trades, more cities",
      "Hourly scanning, no manual runs",
      "Priority setup help",
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
          Angi and HomeStars sell the same lead to three or four of your competitors,
          for $15 to $85 a time. We find the people near you asking for a plumber,
          electrician, contractor — whatever you do — and hand them to you alone.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            variant="brand"
            size="lg"
            nativeButton={false}
            render={<Link href="/login" />}
          >
            Run my free scan
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
          Your trade and your city, and that is it. No credit card, no accounts to
          connect, results in about a minute.
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
