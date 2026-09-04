"use client"

import Link from "next/link"
import { Sparkles, Clock, TriangleAlert } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type State = "free" | "trialing" | "active" | "past_due"

/**
 * The one line in the header that says where the customer stands with us.
 *
 * Four states, each with a different job:
 *
 *   free      — "Upgrade". The only state with a call to action, and the only
 *               state where a click should lead to checkout.
 *   trialing  — days left. Asked for by name: a trial that ends silently is a
 *               surprise charge, and a surprise charge is a refund and a bad
 *               review. Turns amber on the last day.
 *   active    — the plan name, quietly. Nothing to do; hidden on phones to
 *               give the page title its width back.
 *   past_due  — the card was declined and Stripe is retrying. Not linked to
 *               pricing: checking out again creates a *second* subscription.
 *               The fix is the email Stripe already sent them, and the tooltip
 *               says so.
 *
 * Sits beside the credit bar rather than replacing it. Credits are what you
 * can spend today; this is whether you'll still be here next week.
 */
export function PlanBadge({
  state,
  plan,
  daysLeft,
}: {
  state: State
  plan: string | null
  daysLeft: number | null
}) {
  const base =
    "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors"

  if (state === "free") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href="/pricing"
              className={cn(
                base,
                "border-brand/30 bg-brand/10 text-brand hover:bg-brand/15 dark:border-brand/40"
              )}
            />
          }
        >
          <Sparkles className="h-3.5 w-3.5" />
          Upgrade
        </TooltipTrigger>
        <TooltipContent>3-day free trial, then $49 a week or $149 a month</TooltipContent>
      </Tooltip>
    )
  }

  if (state === "trialing") {
    const lastDay = daysLeft !== null && daysLeft <= 1
    const label =
      daysLeft === null
        ? "Trial"
        : daysLeft === 0
          ? "Trial ends today"
          : `Trial · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                base,
                lastDay
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "border-border bg-muted/60 text-muted-foreground"
              )}
            />
          }
        >
          <Clock className="h-3.5 w-3.5" />
          {label}
        </TooltipTrigger>
        <TooltipContent>
          {plan ? `Your ${plan} plan starts billing when the trial ends.` : "Billing starts when the trial ends."}{" "}
          Cancel any time from the email Stripe sent you.
        </TooltipContent>
      </Tooltip>
    )
  }

  if (state === "past_due") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                base,
                "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              )}
            />
          }
        >
          <TriangleAlert className="h-3.5 w-3.5" />
          Payment failed
        </TooltipTrigger>
        <TooltipContent>
          Your card was declined and Stripe is retrying. Update it from the email Stripe sent
          you — your account keeps working in the meantime.
        </TooltipContent>
      </Tooltip>
    )
  }

  // active — quiet, and off the phone header entirely.
  const name = plan === "weekly" ? "Weekly" : plan === "monthly" ? "Monthly" : "Pro"
  return (
    <span className={cn(base, "hidden border-border bg-muted/60 text-muted-foreground sm:inline-flex")}>
      {name}
    </span>
  )
}
