import Link from "next/link"

/**
 * The frame every auth screen sits in: proof on the left, the form on the right.
 *
 * Sign-in used to be a lone card floating on a gradient blur — the same screen
 * a thousand vibe-coded apps ship, and it says nothing about what the product
 * does. That matters more here than on most sign-in pages, because paid ads
 * mean a large share of the people who reach it have never seen the product
 * and are deciding, right there, whether it is real.
 *
 * So the left half carries the thing that is hardest to fake: what the product
 * actually outputs. These are representative examples rather than live rows —
 * a signed-out visitor must never be shown another customer's leads, and this
 * page renders before anyone is authenticated — but they are the real shape,
 * the real platforms, and realistic scores.
 *
 * The panel is decorative and hidden below `lg`. On a phone, where roughly
 * three-quarters of paid traffic lands, the form is the whole screen and gets
 * to the point.
 */

interface SampleLead {
  post: string
  place: string
  platform: string
  age: string
  score: number
}

/**
 * Deliberately mundane. The temptation is to show a $40k renovation, but a
 * contractor reads that as marketing; a leaking roof and a laminate floor read
 * as a normal week, which is the claim we are actually making.
 */
const SAMPLE_LEADS: SampleLead[] = [
  {
    post: "Anyone know a good roofer? Ours started leaking after the storm last night and we've got water coming through the ceiling.",
    place: "Burnaby, BC",
    platform: "Nextdoor",
    age: "2h ago",
    score: 94,
  },
  {
    post: "Looking for someone to install laminate flooring in two bedrooms. Materials already bought, just need it laid properly.",
    place: "Coquitlam, BC",
    platform: "Facebook",
    age: "5h ago",
    score: 91,
  },
  {
    post: "Need a painter for the interior of a 3-bed. Would like it done before we move in end of the month.",
    place: "Surrey, BC",
    platform: "Facebook",
    age: "9h ago",
    score: 87,
  },
]

function ScoreDot({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand tabular-nums">
      <span className="size-1.5 rounded-full bg-brand" aria-hidden />
      {score}
    </span>
  )
}

function ProofPanel() {
  return (
    <div className="relative hidden overflow-hidden border-r border-border bg-accent/30 lg:flex lg:flex-col lg:justify-center lg:px-14 lg:py-16">
      {/* One soft wash, well behind the cards. Any more and the cards stop
          reading as screenshots of a real thing. */}
      <div
        className="pointer-events-none absolute -left-32 top-1/4 size-[34rem] rounded-full bg-brand/10 blur-3xl"
        aria-hidden
      />

      <div className="relative">
        <p className="font-[family-name:var(--font-archivo)] text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Found this week
        </p>
        <h2 className="mt-4 max-w-md text-balance font-[family-name:var(--font-archivo)] text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
          People asking for your trade, before anyone sold them to you.
        </h2>

        <div className="mt-10 flex max-w-md flex-col gap-3">
          {SAMPLE_LEADS.map((lead) => (
            <article
              key={lead.post}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {lead.platform} · {lead.place}
                </span>
                <ScoreDot score={lead.score} />
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-foreground">
                &ldquo;{lead.post}&rdquo;
              </p>
              <p className="mt-3 text-xs text-muted-foreground">{lead.age}</p>
            </article>
          ))}
        </div>

        <p className="mt-8 max-w-md text-sm text-muted-foreground">
          Examples of what the agent surfaces. Angi and HomeStars sell the same
          lead to three or four contractors at once — these go to one.
        </p>
      </div>
    </div>
  )
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <ProofPanel />

      <div className="flex flex-col px-6 py-10 sm:px-10">
        <Link href="/" className="flex w-fit items-center gap-2">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 shadow-sm shadow-blue-600/30">
            <span className="font-bold text-white">O</span>
          </div>
          <span className="font-semibold">Floozy Opportunity AI</span>
        </Link>

        <div className="flex flex-1 items-center">
          <div className="w-full max-w-sm py-12">
            <h1 className="font-[family-name:var(--font-archivo)] text-3xl font-bold tracking-tight">
              {title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
            <div className="mt-8">{children}</div>
          </div>
        </div>

        {footer ? (
          <div className="max-w-sm text-sm text-muted-foreground">{footer}</div>
        ) : null}
      </div>
    </div>
  )
}
