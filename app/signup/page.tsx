"use client"

import { useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthShell } from "@/components/auth/auth-shell"
import { GoogleButton } from "@/components/auth/google-button"

/**
 * Create an account.
 *
 * The page paid traffic lands on, so it asks for as little as it can: email
 * and a password, nothing about the business. Trade and service area are what
 * the agent actually needs, and those are asked for after someone is in and
 * has seen the product work — asking up front turns a signup into a form.
 *
 * No card here either. Billing is a separate, later decision, and saying so
 * on the button removes the one fear that stops a contractor signing up.
 */
export default function SignUpPage() {
  const supabase = createClient()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Where to land after the confirmation link is clicked.
   *
   * /api/checkout sends signed-out visitors here with `?next=/api/checkout…`
   * so the click that started checkout still ends at checkout. Without this
   * they confirm their email, land on the dashboard, and the intent to pay is
   * simply lost.
   *
   * Read from `window.location` inside the handler rather than with
   * `useSearchParams`, which would require a Suspense boundary and opt the
   * whole route out of static rendering for a value only needed on submit.
   *
   * Only same-site paths are honoured. `next` arrives in a URL anyone can
   * craft, and echoing it into a redirect unchecked turns the signup page into
   * an open redirect — a link that looks like ours and lands on theirs.
   */
  const destination = () => {
    if (typeof window === "undefined") return "/"
    const next = new URLSearchParams(window.location.search).get("next")
    return next && next.startsWith("/") && !next.startsWith("//") ? next : "/"
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}${destination()}` },
    })
    setLoading(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  // A confirmation screen rather than a line of green text. The next thing
  // that has to happen is in their inbox, not on this page, and a screen that
  // says so stops people sitting here waiting for something to load.
  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a confirmation link to ${email}.`}
        footer={
          <p>
            Wrong address?{" "}
            <button
              type="button"
              onClick={() => setSent(false)}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Use a different one
            </button>
          </p>
        }
      >
        <div className="flex flex-col gap-4 text-sm text-muted-foreground">
          <p>
            Click the link in that email and you&apos;ll be signed straight in. It can take a
            minute to arrive.
          </p>
          <p>
            Nothing there? Check spam — confirmation mail from a new domain lands there more
            often than it should.
          </p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Start finding work"
      subtitle="Free to look. No card until you decide to keep it."
      footer={
        <p>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      }
    >
      <div className="flex flex-col gap-6">
        <GoogleButton label="Continue with Google" />

        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>

          <Button type="submit" variant="brand" className="w-full" disabled={loading}>
            {loading ? "Creating your account…" : "Create account"}
          </Button>
        </form>

        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          By creating an account you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-4">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </AuthShell>
  )
}
