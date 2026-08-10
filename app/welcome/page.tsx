import Link from "next/link"

/**
 * The public marketing page.
 *
 * Served at `/` by a middleware **rewrite** for signed-out visitors, so the
 * canonical URL a crawler indexes is `/` and not this path. `/welcome` is
 * disallowed in robots.txt for the same reason — it exists only as the rewrite
 * target, and letting both URLs into the index would split the page against
 * itself.
 *
 * Every claim here is the measured one. "About five a day" is 65 opportunities
 * across the 12 days the product actually ran (5.4/day, 4.3/day scoring 80+)
 * in the Vancouver contractor niche. The launch copy deliberately does not say
 * "5-10 a day" — the first person who takes the trial counts what they get.
 *
 * Two standing rules this page follows: it never uses the word "scraper", and
 * it never names the platforms it reads. It also shows no price, because there
 * is no billing system yet and everything is a trial.
 */
export const metadata = {
  title: "Find the people already asking for what you sell",
  alternates: { canonical: "/" },
}

const STEPS = [
  {
    n: "01",
    title: "Tell it what you do",
    body: "In plain English. “I do bathroom renos in Burnaby and I want jobs over $5k.” No keyword lists to maintain.",
  },
  {
    n: "02",
    title: "It reads the groups you're already in",
    body: "Every new public post in the local community groups you follow, all day, without you scrolling.",
  },
  {
    n: "03",
    title: "It scores each post 0–100",
    body: "Real job, your area, your trade. Most posts score low — that is what makes the high ones worth opening.",
  },
  {
    n: "04",
    title: "The good ones land on your dashboard",
    body: "With the place, the ask, and a draft reply written in your own voice, ready to edit.",
  },
  {
    n: "05",
    title: "You send it",
    body: "You read it, change what you want, and answer. A person sends every message — the agent never does.",
  },
]

export default function WelcomePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-[family-name:var(--font-archivo)] text-lg font-bold tracking-tight">
          Opportunity AI
        </span>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/pricing" className="text-muted-foreground hover:text-foreground">
            Pricing
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-foreground px-5 py-2 font-medium text-background hover:opacity-90"
          >
            Sign in
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 md:pt-24">
        <p className="mb-6 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Opportunity intelligence
        </p>
        <h1 className="font-[family-name:var(--font-archivo)] text-5xl font-black leading-[0.98] tracking-tight md:text-7xl">
          Find the people already
          <br />
          asking for what you sell.
        </h1>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
          Every day someone near you posts “can anyone recommend a good electrician?” in a local
          community group. Forty people see it before you do. Opportunity AI reads those posts and
          tells you which ones are a real job.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/login"
            className="rounded-full bg-foreground px-8 py-4 text-base font-semibold text-background hover:opacity-90"
          >
            Start a 7-day free trial
          </Link>
          <Link
            href="/pricing"
            className="rounded-full border border-border px-8 py-4 text-base font-semibold hover:bg-accent"
          >
            See pricing
          </Link>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">No card required.</p>
      </section>

      {/* The measured number */}
      <section className="border-y border-border bg-accent/40">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-[auto_1fr] md:items-center md:gap-16">
          <div className="flex items-baseline gap-3">
            <span className="font-[family-name:var(--font-archivo)] text-8xl font-black leading-none tracking-tighter md:text-9xl">
              5
            </span>
            <span className="text-2xl font-bold text-muted-foreground">a day</span>
          </div>
          <div>
            <h2 className="font-[family-name:var(--font-archivo)] text-2xl font-bold md:text-3xl">
              About five a day, in the Vancouver area.
            </h2>
            <p className="mt-4 max-w-xl text-muted-foreground">
              Four of them score 80 or higher — the ones worth calling first. That is the real
              figure off a live dashboard over twelve days on the contractor niche, not a
              projection. Your number depends on your trade and how many groups you follow.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-[family-name:var(--font-archivo)] text-3xl font-black tracking-tight md:text-4xl">
          How it works
        </h2>
        <ol className="mt-12 grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n}>
              <div className="text-sm font-bold tracking-[0.2em] text-muted-foreground">{s.n}</div>
              <h3 className="mt-3 font-[family-name:var(--font-archivo)] text-xl font-bold">
                {s.title}
              </h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Against bought leads */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-[family-name:var(--font-archivo)] text-3xl font-black tracking-tight md:text-4xl">
            Not a lead you rent.
          </h2>
          <div className="mt-8 grid gap-8 md:grid-cols-2">
            <p className="text-lg leading-relaxed text-muted-foreground">
              Buying leads means buying a race. The same name goes to four contractors and whoever
              calls back inside ten minutes wins the job you already paid for.
            </p>
            <p className="text-lg leading-relaxed text-muted-foreground">
              The person who needed that work posted about it publicly before any of that happened.
              You get the post itself — and nobody else was sold the same name.
            </p>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-border bg-accent/40">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="font-[family-name:var(--font-archivo)] text-4xl font-black tracking-tight md:text-5xl">
            Seven days free.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Point it at your trade and count what it finds.
          </p>
          <Link
            href="/login"
            className="mt-10 inline-block rounded-full bg-foreground px-10 py-4 text-base font-semibold text-background hover:opacity-90"
          >
            Start free
          </Link>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10 text-sm text-muted-foreground">
        <span>© {new Date().getFullYear()} Opportunity AI</span>
        <nav className="flex gap-6">
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/login" className="hover:text-foreground">
            Sign in
          </Link>
        </nav>
      </footer>
    </main>
  )
}
