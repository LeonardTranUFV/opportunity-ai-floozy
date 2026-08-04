import Link from "next/link"
import { Compass } from "lucide-react"

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-sky-400/15 to-blue-600/15 blur-3xl" />

      <div className="relative flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-brand/10">
          <Compass className="size-5 text-brand" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            That link doesn&apos;t point anywhere in the app. It may have been renamed or removed.
          </p>
        </div>
        <Link
          href="/"
          className="flex h-9 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
