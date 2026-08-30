"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthShell } from "@/components/auth/auth-shell"
import { GoogleButton } from "@/components/auth/google-button"

/**
 * Sign in.
 *
 * Creating an account and resetting a password now live on their own routes
 * rather than behind toggles here. The old single screen changed its own title,
 * its description and the meaning of its button depending on two pieces of
 * state, so "sign up" and "sign in" looked identical and people submitted the
 * wrong one — which is what "the login page is confusing" meant.
 *
 * Separate routes also give the ads somewhere to point: /signup is a page you
 * can buy traffic to, a toggle is not.
 */
export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [usePassword, setUsePassword] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (usePassword) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      setLoading(false)
      if (error) {
        setError(error.message)
        return
      }
      router.push("/")
      router.refresh()
      return
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/` },
    })
    setLoading(false)
    if (error) setError(error.message)
    else setMessage(`Link sent to ${email}. It signs you straight in — no password needed.`)
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to see what your agents have found."
      footer={
        <p>
          New here?{" "}
          <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
            Create an account
          </Link>
        </p>
      }
    >
      <div className="flex flex-col gap-6">
        <GoogleButton label="Sign in with Google" />

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

          {usePassword ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/reset-password"
                  className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Forgot it?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          ) : null}

          <Button type="submit" variant="brand" className="w-full" disabled={loading}>
            {loading ? "One moment…" : usePassword ? "Sign in" : "Email me a sign-in link"}
          </Button>

          {/* Says what changes, not what it is called. "Use password instead"
              is a decision; "Password mode" is a label. */}
          <button
            type="button"
            onClick={() => {
              setUsePassword((v) => !v)
              setError(null)
              setMessage(null)
            }}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            {usePassword ? "Email me a link instead" : "Use a password instead"}
          </button>
        </form>

        {message ? (
          <p className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </AuthShell>
  )
}
