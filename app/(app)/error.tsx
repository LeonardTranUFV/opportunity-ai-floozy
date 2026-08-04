"use client"

import { useEffect } from "react"
import Link from "next/link"
import { AlertTriangle, RotateCw, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Error boundary for the signed-in app.
 *
 * Without this, a throw in any server component (Supabase unreachable, a
 * Gemini failure surfacing through a page, a bad query) drops the user on
 * Next.js's raw error screen — which on production is a bare "Application
 * error" with no way forward.
 *
 * Deliberately shows the real message rather than a generic apology: this is a
 * single-operator B2B tool, and "Gemini quota exceeded" tells Leo exactly what
 * to do, where "Something went wrong" would send him hunting.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Server errors are only visible in the Vercel function log, which nobody
    // is watching. Mirroring to the browser console means a screenshot of the
    // devtools is enough to diagnose it.
    console.error("App route error:", error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl bg-card p-6 text-center ring-1 ring-foreground/10">
        <span className="flex size-11 items-center justify-center rounded-full bg-amber-500/10">
          <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400" />
        </span>

        <div className="flex flex-col gap-1.5">
          <h2 className="font-heading text-lg font-medium">This page didn&apos;t load</h2>
          <p className="text-sm text-muted-foreground">
            Something failed on the server. Trying again often fixes it — a lot of these are
            temporary AI or database timeouts.
          </p>
        </div>

        {error.message && (
          <p className="w-full break-words rounded-md bg-muted/60 px-3 py-2 text-left font-mono text-xs text-muted-foreground">
            {error.message.slice(0, 300)}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="brand" onClick={reset}>
            <RotateCw className="size-3.5" />
            Try again
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
            <ArrowLeft className="size-3.5" />
            Back to dashboard
          </Button>
        </div>

        {error.digest && (
          <span className="text-[0.7rem] text-muted-foreground">Reference: {error.digest}</span>
        )}
      </div>
    </div>
  )
}
