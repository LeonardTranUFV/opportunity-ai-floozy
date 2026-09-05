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
import { Reveal } from "@/components/marketing/reveal"
import { TiltCard } from "@/components/marketing/tilt-card"
import { DepthField } from "@/components/marketing/depth-field"

// Title carries no product suffix — the root layout's template appends it.
export const metadata = {
  title: "Pricing",
  description:
    "See who near you has been asking for your trade in the last 90 days — free, no card, no account to connect. Then $49 a week or $149 a month, after a 3-day trial. Less than one shared lead from Angi or HomeStars.",
  alternates: { canonical: "/pricing" },
}

/**
 * Checkout goes through /api/checkout, never straight to the Stripe link.
 *
 * That route attaches the signed-in user's id as `client_reference_id` before
 * forwarding, which is the only thing that later lets a webhook say *which
 * account* just paid. Linking directly takes the money and leaves the payment
 * anonymous — the customer gets charged and their account never changes.
 *
 * It also sends anyone signed out to create an account first and returns them
 * to checkout afterwards: an account with no payment is recoverable, a payment
 * with no account is a support ticket and a refund.
 *
 * Prices are CAD because the Stripe account is Canadian; a US visitor sees the
 * CAD amount converted at checkout. Worth revisiting if the US ends up the
 * larger half of spend.
 *
 * The older $97 Starter and $197 Pro links still exist in Stripe and still
 * bill anyone already on them. They are simply no longer offered here.
 *
 * ── On the motion ──────────────────────────────────────────────────────────
 *
 * Same depth system as /welcome (components/marketing, the .mk- rules in
 * globals.css): the hero has parallax planes behind it, the three plan cards
 * surface one after another and turn toward the pointer. Prices, copy and
 * links are untouched — this page's job is to be trusted, and motion that
 * drew attention away from the numbers would work against it. Everything is
 * readable at rest and switches off under reduced motion.
 */
const WEEKLY_LINK = "/api/checkout?plan=weekly"
const MONTHLY_LINK = "/api/checkout?plan=monthly"

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
    // /scan, not /login. This tier's entire promise is "no account", and
    // pointing it at a sign-in wall breaks that in one click.
    href: "/scan",
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
    <div className="min-h-screen overflow-x-hidden bg-background">
      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
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

      {/* Tighter on a phone. Three-quarters of paid traffic lands on one, and
          at the desktop spacing the hero filled the entire first screen — the
          prices, which are the reason anyone opened this page, sat below the
          fold behind a scroll. */}
      <section className="mk-stage relative">
        <DepthField />
        <div className="relative z-10 mx-auto max-w-3xl px-6 pt-6 pb-10 text-center sm:pt-10 sm:pb-16">
          <Reveal>
            <Badge variant="brand" className="mb-4">
              For trades &amp; local service businesses
            </Badge>
          </Reveal>
          <Reveal delay={70}>
            <h1 className="text-balance text-[2rem] font-semibold leading-[1.12] tracking-tight sm:text-5xl sm:leading-tight">
              See the leads before your competitors even look.
            </h1>
          </Reveal>
          <Reveal as="p" delay={140} className="mt-4 text-pretty text-lg text-muted-foreground">
            Angi and HomeStars sell the same lead to three or four of your competitors,
            for $15 to $85 a time. We find the people near you asking for a plumber,
            electrician, contractor — whatever you do — and hand them to you alone.
          </Reveal>
          <Reveal delay={210} className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              variant="brand"
              size="lg"
              className="mk-lift"
              nativeButton={false}
              render={<Link href="/scan" />}
            >
              Run my free scan
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="mk-lift"
              nativeButton={false}
              render={<a href="#pricing" />}
            >
              See pricing
            </Button>
          </Reveal>
          <Reveal as="p" delay={280} className="mt-3 text-xs text-muted-foreground">
            Your trade and your city, and that is it. No credit card, no accounts to
            connect, results in about a minute.
          </Reveal>
        </div>
      </section>

      <section id="pricing" className="mk-stage mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-6 sm:grid-cols-3">
          {TIERS.map((tier, i) => (
            <Reveal key={tier.name} delay={80 + i * 90} className="flex">
              {/* A small tilt, and the same on every column: the popular plan
                  is already marked, and making it move more than its
                  neighbours would be a thumb on the scale. */}
              <TiltCard max={5} className="flex w-full rounded-xl">
                <Card
                  className={`w-full ${tier.highlighted ? "relative ring-2 ring-brand" : "relative"}`}
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
                      <span className="text-3xl font-semibold tracking-tight">{tier.price}</span>
                      <span className="text-sm text-muted-foreground">{tier.period}</span>
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
                      className="mk-lift w-full"
                      nativeButton={false}
                      render={<Link href={tier.href} />}
                    >
                      {tier.cta}
                    </Button>
                  </CardFooter>
                </Card>
              </TiltCard>
            </Reveal>
          ))}
        </div>
        {/* This paragraph has now been wrong in both directions, which is worth a
            note so it doesn't flip a third time.

            It first promised Facebook, LinkedIn and Nextdoor as self-serve when
            they weren't. It was then rewritten to say Reddit "runs itself" —
            true at the time, and false since Reddit closed new Data API
            registrations to anything that isn't a moderation tool.

            What is true as of 2026-08-30: the cloud-browser connect works, so
            the signed-in platforms are the ones a customer can switch on alone.
            Reddit is the one that can't currently collect. Whatever this says,
            it has to match what a customer gets on the day they pay. */}
        <Reveal as="p" delay={120} className="mx-auto mt-8 max-w-2xl text-center text-xs text-muted-foreground">
          Facebook, LinkedIn, Nextdoor and X each take one sign-in with your own
          account — about two minutes in a secure browser session you drive
          yourself. Prefer a hand? We&apos;ll do it with you on a call.
        </Reveal>
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
