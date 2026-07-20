import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ConnectAccountsForm } from "@/components/accounts/connect-accounts-form"
import { SessionStatus } from "@/components/accounts/session-status"

export default function AccountsPage() {
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
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-muted-foreground">
            <li>Click a button below to launch a visible browser window.</li>
            <li>Log into the Facebook or LinkedIn account in the popup browser.</li>
            <li>Authorize any 2FA codes directly in the official portal.</li>
            <li>
              <strong className="text-foreground">Once completed, close the popup browser window manually.</strong>
            </li>
          </ol>
          <p className="text-xs text-blue-600 dark:text-blue-400">
            Cookies are kept locally on disk inside an auth profile — never sent anywhere else.
          </p>
          <ConnectAccountsForm />
        </CardContent>
      </Card>
    </div>
  )
}
