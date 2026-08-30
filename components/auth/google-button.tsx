"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

/**
 * Sign in with Google.
 *
 * Renders nothing unless NEXT_PUBLIC_GOOGLE_AUTH is "1", and that gate is the
 * point rather than caution: Supabase only completes this flow once a Google
 * Cloud OAuth client exists and its secret has been pasted into the Supabase
 * dashboard. Shipping the button before that is done gives every visitor a
 * prominent option that fails — on the one screen where a stranger is deciding
 * whether the product is real.
 *
 * So the button appears the moment the provider is configured, and not a
 * deploy earlier. Turning it on is one environment variable.
 */
export function GoogleButton({ label }: { label: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (process.env.NEXT_PUBLIC_GOOGLE_AUTH !== "1") return null

  const signIn = async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // `next` is read by /auth/callback, which is already a public path.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/` },
    })
    // Success navigates away, so reaching here at all means it did not.
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={signIn}
        disabled={loading}
      >
        <GoogleMark />
        {loading ? "Opening Google…" : label}
      </Button>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}

/** Google's mark, inlined — the CSP allows no third-party images. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.02-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}
