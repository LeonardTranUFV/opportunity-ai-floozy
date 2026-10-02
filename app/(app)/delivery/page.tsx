import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { mailerConfigured, senderAddress } from "@/lib/mailer"
import { RecipientsManager, type Recipient, type AgentOption } from "@/components/delivery/recipients-manager"
import { MIN_SCORE, FRESH_DAYS, WEEK_DAYS, UNDATED_SEEN_DAYS } from "@/lib/lead-digest"

export const dynamic = "force-dynamic"

/**
 * Who gets the morning leads.
 *
 * This existed before as lead-recipients.json on the operator's PC plus a
 * Task Scheduler entry — which worked, but meant adding a client was editing
 * a file on one machine, and nothing went out if that machine was asleep.
 */
export default async function DeliveryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: recipients, error: recipientsError }, { data: agents }] = await Promise.all([
    supabase.from("lead_recipients").select("*").order("created_at", { ascending: true }),
    supabase.from("agents").select("id, name").order("created_at", { ascending: true }),
  ])

  // There is no migration runner here — migrations are pasted into the
  // Supabase SQL editor by hand — so this page can be deployed before its
  // table exists. Without this it would render an empty list and every save
  // would fail with a Postgres code, which is a long way from "run 0019".
  const tableMissing =
    !!recipientsError &&
    (recipientsError.code === "PGRST205" || /does not exist|schema cache/i.test(recipientsError.message))

  const ready = mailerConfigured()
  const from = senderAddress()

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Morning lead delivery</CardTitle>
          <CardDescription>
            Each client gets one email at the time you pick, in their own timezone, with a spreadsheet of every new
            lead — the post link, the profile link, a phone number where one was given, the score and the location.
            {from ? ` Sent from ${from}.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            <li>
              A lead goes out once it scores <strong className="text-foreground">{MIN_SCORE} or better</strong> and was
              posted in the last {WEEK_DAYS} days — split into &ldquo;fresh&rdquo; (last {FRESH_DAYS} days) and
              &ldquo;this week&rdquo;.
            </li>
            <li>
              Posts the platform gave no date for go out only if we first saw them in the last {UNDATED_SEEN_DAYS} days,
              in their own group so nobody mistakes them for fresh.
            </li>
            <li>Nothing is ever sent twice — each client&apos;s delivered leads are recorded.</li>
            <li>Rows with no link to the post are left out: there would be nothing to act on.</li>
          </ul>
        </CardContent>
      </Card>

      {tableMissing ? (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="text-lg">One migration to run first</CardTitle>
            <CardDescription>
              This page stores its clients in a table that isn&apos;t in the database yet. Paste{" "}
              <code>supabase/migrations/0019_lead_delivery.sql</code> into the Supabase SQL editor and reload — nothing
              here works until then.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <RecipientsManager
          initial={(recipients ?? []) as Recipient[]}
          agents={(agents ?? []) as AgentOption[]}
          mailReady={ready}
        />
      )}
    </div>
  )
}
