"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

type Mode = "magic-link" | "password"
type OAuthProvider = "google" | "facebook"

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>("magic-link")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setMessage("Check your email for a login link.")
    }
  }

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      setLoading(false)
      if (error) {
        setError(error.message)
      } else {
        setMessage("Check your email to confirm your account.")
      }
      return
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      router.push("/")
      router.refresh()
    }
  }

  const handleForgotPassword = async () => {
    if (!email) {
      setError("Enter your email above first, then click \"Forgot password\".")
      return
    }
    setLoading(true)
    setError(null)
    setMessage(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
    })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setMessage("Check your email for a password reset link.")
    }
  }

  const handleOAuth = async (provider: OAuthProvider) => {
    setOauthLoading(provider)
    setError(null)
    setMessage(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setOauthLoading(null)
      setError(error.message)
    }
    // On success the browser is redirected away to the provider, so no
    // further local state update happens here.
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-sky-400/20 to-blue-600/20 blur-3xl" />
      <Card className="relative w-full max-w-sm shadow-lg">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 shadow-sm shadow-blue-600/30">
              <span className="font-bold text-white">O</span>
            </div>
            <span className="font-semibold">Opportunity AI</span>
          </div>
          <CardTitle>{mode === "magic-link" ? "Sign in" : isSignUp ? "Create account" : "Sign in"}</CardTitle>
          <CardDescription>
            {mode === "magic-link"
              ? "We'll email you a link — no password needed."
              : "Use your email and password."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOAuth("google")}
              disabled={oauthLoading !== null}
            >
              <GoogleIcon className="size-4" />
              {oauthLoading === "google" ? "Redirecting…" : "Continue with Google"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOAuth("facebook")}
              disabled={oauthLoading !== null}
            >
              <FacebookIcon className="size-4" />
              {oauthLoading === "facebook" ? "Redirecting…" : "Continue with Facebook"}
            </Button>
          </div>

          <div className="mb-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {mode === "magic-link" ? (
            <form onSubmit={handleMagicLink} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <Button type="submit" variant="brand" disabled={loading}>
                {loading ? "Sending…" : "Send magic link"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handlePassword} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email-pw">Email</Label>
                <Input
                  id="email-pw"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  required
                />
              </div>
              <Button type="submit" variant="brand" disabled={loading}>
                {loading ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
              </Button>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsSignUp((v) => !v)}
                  className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-brand"
                >
                  {isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}
                </button>
                {!isSignUp && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-brand"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
            </form>
          )}

          {message && (
            <p className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
              {message}
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === "magic-link" ? "password" : "magic-link"))
              setMessage(null)
              setError(null)
            }}
            className="mt-4 text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-brand"
          >
            {mode === "magic-link" ? "Use email + password instead" : "Use a magic link instead"}
          </button>
        </CardContent>
      </Card>
    </div>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4c-7.4 0-13.8 4.1-17.1 10.1z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.5-2.1 14.2-5.6l-6.6-5.5C29.5 34.5 26.9 35.5 24 35.5c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.9 39.6 16.4 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.6 5.5C41.4 35.4 44 30.1 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  )
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="#1877F2">
      <path d="M24 12.07C24 5.4 18.6 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
    </svg>
  )
}
