"use client"

import { useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthShell } from "@/components/auth/auth-shell"

/**
 * Ask for a password reset link.
 *
 * Previously this was a "Forgot password" button on the sign-in form that
 * quietly reused whatever was typed in the email field — so clicking it with
 * an empty field produced an instruction rather than an email, and clicking it
 * with a password already typed looked like it had submitted the form.
 *
 * The confirmation deliberately does not reveal whether the address has an
 * account. Different answers for "sent" and "no such user" turn this page into
 * a way to test whether an email address is a customer.
 */
export default function ResetPasswordPage() {
  const supabase = createClient()

  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    })
    setLoading(false)
    // Rate limiting is worth surfacing — it is actionable ("wait a minute").
    // Anything else resolves to the same neutral confirmation below.
    if (error && error.status === 429) setError(error.message)
    else setSent(true)
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`If ${email} has an account, a reset link is on its way.`}
        footer={
          <p>
            <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
              Back to sign in
            </Link>
          </p>
        }
      >
        <p className="text-sm text-muted-foreground">
          The link opens a page where you choose a new password. It expires after an hour, so
          if you come back to it tomorrow, just ask for another.
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <p>
          Remembered it?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      }
    >
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

        <Button type="submit" variant="brand" className="w-full" disabled={loading}>
          {loading ? "Sending…" : "Send reset link"}
        </Button>

        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </AuthShell>
  )
}
