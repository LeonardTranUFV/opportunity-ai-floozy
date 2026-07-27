import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ConnectAccountsForm } from "@/components/accounts/connect-accounts-form"
import { SessionStatus } from "@/components/accounts/session-status"
import { EmptyState } from "@/components/ui/empty-state"
import { ServerOff } from "lucide-react"
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
          <ConnectAccountsForm />
        </CardContent>
      </Card>
    </div>
  )
}
