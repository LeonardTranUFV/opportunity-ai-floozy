import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ConnectAccountsForm } from "@/components/accounts/connect-accounts-form"
import { SessionStatus } from "@/components/accounts/session-status"
import { EmptyState } from "@/components/ui/empty-state"
import { ServerOff, ShieldAlert } from "lucide-react"
import { isHostedDeployment } from "@/lib/deployment"

export default function AccountsPage() {
  if (isHostedDeployment()) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-bold tracking-tight">Connect Accounts</h2>
          <p className="text-muted-foreground">
            Authorize the live crawler to monitor target community groups on your behalf.
          </p>
        </div>
        <Card>
          <CardContent>
            <EmptyState
              icon={ServerOff}
              title="Not available on this hosted preview"
              description="Connecting Facebook/LinkedIn/Nextdoor/X requires a real, visible browser window and a persistent local session — that only works on the operator's own machine, not this hosted deployment. Reach out to have your accounts connected there."
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-bold tracking-tight">Connect Accounts</h2>
        <p className="text-muted-foreground">
          Authorize the live crawler to monitor target community groups on your behalf.
        </p>
      </div>

      <Card>
        <CardContent>
          <SessionStatus />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How this works</CardTitle>
          <CardDescription>Your password is never captured by this app.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <ol className="flex flex-col gap-3 text-sm text-muted-foreground">
            {[
              "Click a button below to launch a visible browser window.",
              "Log into the Facebook, LinkedIn, Nextdoor, or X account in the popup browser.",
              "Authorize any 2FA codes directly in the official portal.",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold text-brand">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold text-brand">
                4
              </span>
              <strong className="text-foreground">Once completed, close the popup browser window manually.</strong>
            </li>
          </ol>
          <p className="rounded-md border border-brand/20 bg-brand/5 px-3 py-2 text-xs text-brand">
            Cookies are kept locally on disk inside an auth profile — never sent anywhere else.
          </p>

          {/* Shown before the connect buttons, not buried in the Terms. Reading a
              feed through your own logged-in session is against these platforms'
              terms, and the realistic downside lands on the customer's personal
              account — so they get to see that before they opt in, not after. */}
          <div className="flex gap-3 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
              <span className="font-medium">Before you connect — please read</span>
              <p>
                This reads your feed through your own logged-in session, which these platforms&apos;
                terms of service don&apos;t allow. It&apos;s paced to look like normal human browsing, and
                every customer uses only their own account — never a shared or fake one. Even so, any
                account used with automation can be restricted or suspended, and that would affect your
                personal account and its group memberships. Scanning less often lowers the risk.{" "}
                <a href="/terms" className="underline decoration-dotted underline-offset-2">
                  Full terms
                </a>
                .
              </p>
            </div>
          </div>

          <ConnectAccountsForm />
        </CardContent>
      </Card>
    </div>
  )
}
