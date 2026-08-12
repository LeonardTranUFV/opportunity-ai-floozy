import Link from "next/link"

// Title carries no product suffix — the root layout's template appends it.
export const metadata = {
  title: "Terms of Service",
  description: "The terms covering use of Opportunity AI, including acceptable use and account rules.",
  alternates: { canonical: "/terms" },
}

// Bumping this is not cosmetic — TERMS_VERSION in lib/consent.ts must match,
// and a change here means existing users are asked to accept again.
const LAST_UPDATED = "August 11, 2026"

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 shadow-sm shadow-blue-600/30">
            <span className="font-bold text-white">O</span>
          </div>
          <span className="font-semibold">Floozy Opportunity AI</span>
        </Link>
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 text-sm leading-relaxed text-muted-foreground">
        <h1 className="mb-1 text-3xl font-semibold tracking-tight text-foreground">Terms of Service</h1>
        <p className="mb-10 text-xs">Last updated: {LAST_UPDATED}</p>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">1. Agreement to Terms</h2>
          <p>
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of Floozy Opportunity
            AI (the &quot;Service&quot;), operated by Floozy (&quot;we,&quot; &quot;us,&quot; or
            &quot;our&quot;). By creating an account or using the Service, you agree to be bound by these
            Terms. If you do not agree, do not use the Service.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">2. What the Service Does</h2>
          <p>
            Floozy Opportunity AI monitors community groups on Facebook, LinkedIn, and other supported
            platforms for posts relevant to your business, uses artificial intelligence to evaluate and
            score those posts, and can draft personalized outreach messages on your behalf. You choose
            whether to send any drafted message — the Service does not send anything without your
            explicit action.
          </p>
          <p className="mt-3">
            <strong>The Service reads those communities using your own connected accounts</strong>, acting
            on your behalf as if you were reading them yourself. It only reaches communities you have
            already joined. Those platforms are operated by third parties whose own terms of service govern
            your account with them, and automated access may breach those terms. You are responsible for
            your accounts on those platforms and you accept the risk that a platform may restrict, suspend
            or terminate one. We do not control that and cannot restore access to an account we do not
            operate.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">3. Eligibility &amp; Account Registration</h2>
          <p>
            The Service is intended for business use by individuals who are at least 18 years old and
            authorized to act on behalf of the business they represent. You are responsible for
            maintaining the confidentiality of your account credentials and for all activity under your
            account.
          </p>
        </section>

        <section className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            4. Connecting Third-Party Accounts — Please Read Carefully
          </h2>
          <p className="mb-3">
            To monitor Facebook, LinkedIn, Nextdoor, or other platforms, you connect your own account on
            that platform directly through that platform&apos;s own login page. We never see, capture, or
            store your password for any third-party platform.
          </p>
          <p className="mb-3">
            <strong className="text-foreground">
              Using automated or semi-automated tools to monitor groups and send messages may violate the
              terms of service of Facebook, LinkedIn, Nextdoor, X, or other platforms you connect.
            </strong>{" "}
            Violating a platform&apos;s terms can result in that platform restricting, suspending, or
            permanently banning your account on that platform, entirely at that platform&apos;s discretion
            and outside of our control.
          </p>
          <p>
            By connecting an account, you acknowledge this risk and agree that Floozy is not responsible
            or liable for any action taken against your account by Facebook, LinkedIn, Nextdoor, X, or any
            other third-party platform. You are solely responsible for deciding whether to connect an
            account and for complying with that platform&apos;s own terms.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">5. AI-Generated Content</h2>
          <p className="mb-3">
            Opportunity scores, summaries, and draft outreach messages (comments and direct messages) are
            generated by artificial intelligence. AI-generated content can be inaccurate, generic, or
            inappropriate in ways that are not always obvious at a glance.
          </p>
          <p>
            You are solely responsible for reviewing any AI-drafted content before it is sent, and for the
            consequences of sending it. The Service will never send a comment or message without you
            taking an explicit, confirmed action to send it.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">6. Subscriptions, Billing &amp; Credits</h2>
          <p className="mb-3">
            Paid plans are billed monthly in advance. Each plan includes a monthly allowance of usage
            credits, which are consumed by AI-driven actions (scanning posts, generating outreach drafts).
            Unused credits roll over to the following month while your subscription remains active. If you
            exhaust your credits, AI-driven actions pause until your next billing cycle or until you add
            more credits.
          </p>
          <p className="mb-3">
            You may cancel your subscription at any time; cancellation takes effect at the end of your
            current billing period. Except where required by law, fees already paid are non-refundable.
          </p>
          <p>We may change our pricing or credit costs going forward, with notice posted on this page or communicated directly to active subscribers before the change takes effect.</p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">7. Acceptable Use</h2>
          <p className="mb-2">You agree not to use the Service to:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>Send spam, harassment, or misleading messages to people found through the Service.</li>
            <li>Attempt to circumvent usage limits, credit limits, or plan restrictions.</li>
            <li>Resell, sublicense, or provide access to the Service to third parties without our written consent.</li>
            <li>Use the Service for any unlawful purpose or in a way that violates the rights of others.</li>
            <li>Reverse-engineer, scrape, or attempt to extract the Service&apos;s underlying data or source code.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">8. Data &amp; Privacy</h2>
          <p>
            Our collection and use of information is described in our{" "}
            <Link href="/privacy" className="text-brand underline decoration-dotted underline-offset-4 hover:text-brand/80">
              Privacy Policy
            </Link>
            , which forms part of these Terms.
          </p>
          <p className="mt-3">
            <strong>Shared Opportunity Pool.</strong> This is optional and off unless you switch it on. If
            you switch it on, the opportunities your agents find become readable by us and by a limited
            number of accounts we have authorised, who may act on them — including businesses that compete
            with you. You grant us a non-exclusive licence to use those opportunities for that purpose for
            as long as the setting is on. You can switch it off at any time in Settings, which stops future
            opportunities being shared; it cannot retract one already viewed or acted upon. Section 7 of
            the Privacy Policy sets this out in full.
          </p>
          <p className="mt-3">
            Opportunities describe posts written by real people who are not party to these Terms. You are
            responsible for how you contact them and for complying with the law that applies to you,
            including anti-spam law (in Canada, CASL) and privacy law (in Canada, PIPEDA).
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">9. Disclaimer of Warranties</h2>
          <p>
            The Service is provided &quot;as is&quot; and &quot;as available.&quot; We do not guarantee any
            specific number, quality, or conversion rate of leads or opportunities. We do not guarantee
            uninterrupted or error-free operation, or that any particular social platform will remain
            accessible or that our monitoring of it will continue to function, since this depends in part
            on factors outside our control (including changes made by those platforms).
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">10. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, Floozy and its owners, employees, and contractors will
            not be liable for any indirect, incidental, special, consequential, or punitive damages,
            including lost profits or lost business opportunities, arising from your use of the Service —
            including, without limitation, any action taken by a third-party platform against an account
            you connected, or any consequence of sending an AI-drafted message you chose to send.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">11. Termination</h2>
          <p>
            We may suspend or terminate your account if you violate these Terms, misuse the Service, or
            for other reasonable business or legal cause. You may stop using the Service and cancel your
            account at any time.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">12. Changes to These Terms</h2>
          <p>
            We may update these Terms from time to time. If we make material changes, we will make
            reasonable efforts to notify active subscribers before the changes take effect. Continued use
            of the Service after changes take effect constitutes acceptance of the updated Terms.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">13. Governing Law</h2>
          <p>
            These Terms are governed by the laws of the Province of British Columbia, Canada, without
            regard to conflict-of-law principles.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">14. Contact</h2>
          <p>Questions about these Terms can be sent to the email address you use to communicate with your Floozy contact.</p>
        </section>
      </main>
    </div>
  )
}
