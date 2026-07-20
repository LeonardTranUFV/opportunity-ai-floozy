"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

type Mode = "magic-link" | "password"

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>("magic-link")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 shadow-sm">
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
              <Button type="submit" disabled={loading}>
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
              <Button type="submit" disabled={loading}>
                {loading ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
              </Button>
              <button
                type="button"
                onClick={() => setIsSignUp((v) => !v)}
                className="text-xs text-muted-foreground underline"
              >
                {isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}
              </button>
            </form>
          )}

          {message && <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">{message}</p>}
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === "magic-link" ? "password" : "magic-link"))
              setMessage(null)
              setError(null)
            }}
            className="mt-4 text-xs text-muted-foreground underline"
          >
            {mode === "magic-link" ? "Use email + password instead" : "Use a magic link instead"}
          </button>
        </CardContent>
      </Card>
    </div>
  )
}
