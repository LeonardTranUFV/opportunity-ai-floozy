import Link from "next/link"
import { ProofPanel, ProofStrip } from "@/components/auth/proof-panel"

/**
 * The frame every auth screen sits in: proof on the left, the form on the right.
 *
 * Sign-in used to be a lone card floating on a gradient blur — the screen a
 * thousand vibe-coded apps ship, saying nothing about what the product does.
 * That matters more here than on most sign-in pages, because paid ads mean a
 * large share of the people who reach it have never seen the product and are
 * deciding, right there, whether it is real.
 *
 * The left half is hidden below `lg`. On a phone, where roughly three-quarters
 * of paid traffic lands, the form is the whole screen and gets to the point.
 */
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

        {/* Centred only from `lg`. On a phone the column is taller than its
            content, so centring buried the heading under a screen of empty
            space and pushed the form toward the fold. */}
        <div className="flex flex-1 lg:items-center">
          <div className="w-full max-w-sm py-8 lg:py-12">
            <div className="mb-8">
              <ProofStrip />
            </div>
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
