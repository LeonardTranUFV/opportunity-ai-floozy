import Link from "next/link"

export const metadata = {
  title: "Privacy Policy — Floozy Opportunity AI",
  description: "Privacy Policy for Floozy Opportunity AI.",
}

const LAST_UPDATED = "August 2, 2026"

export default function PrivacyPage() {
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
        <h1 className="mb-1 text-3xl font-semibold tracking-tight text-foreground">Privacy Policy</h1>
        <p className="mb-10 text-xs">Last updated: {LAST_UPDATED}</p>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">1. What This Policy Covers</h2>
          <p>
            This Privacy Policy explains what information Floozy Opportunity AI (&quot;we,&quot;
            &quot;us&quot;) collects, how we use it, and who we share it with. It applies to your use of
            the Floozy Opportunity AI web application.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">2. Information We Collect</h2>
          <ul className="ml-5 list-disc space-y-2">
            <li>
              <strong className="text-foreground">Account information</strong> — your email address and
              authentication details, managed via our authentication provider (Supabase).
            </li>
            <li>
              <strong className="text-foreground">Business profile</strong> — your business name, pitch,
              and contact details you choose to provide, used to personalize AI-generated outreach.
            </li>
            <li>
              <strong className="text-foreground">Connected platform sessions</strong> — when you connect
              Facebook, LinkedIn, Nextdoor, or another platform, you log in directly on that platform.
              Your login session for that platform is stored locally, tied to your account, and used only
              to monitor the community groups you&apos;ve chosen. We do not receive or store your password
              for that platform.
            </li>
            <li>
              <strong className="text-foreground">Scraped public post content</strong> — text, author
              name, and public profile links from posts in the community groups you choose to monitor,
              collected only from content that platform already shows to your own logged-in account —
              never anything behind a wall your account cannot already see.
            </li>
            <li>
              <strong className="text-foreground">Payment information</strong> — subscription payments are
              processed by Stripe. We do not receive or store your full card number.
            </li>
            <li>
              <strong className="text-foreground">Usage data</strong> — actions you take in the app (scans
              run, drafts generated, credits used), used for billing, product improvement, and support.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">3. How We Use Information</h2>
          <ul className="ml-5 list-disc space-y-1">
            <li>To operate the Service — monitoring groups, scoring posts, generating outreach drafts.</li>
            <li>To process payments and manage your subscription and usage credits.</li>
            <li>To provide customer support and respond to your requests.</li>
            <li>To improve the Service, including diagnosing bugs and reliability issues.</li>
            <li>To comply with legal obligations.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">4. Third Parties We Share Data With</h2>
          <p className="mb-2">We use the following third-party services to operate the Service. Each processes data on our behalf, under their own terms:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li><strong className="text-foreground">Google Gemini API</strong> — evaluates scraped post text and generates outreach drafts.</li>
            <li><strong className="text-foreground">Supabase</strong> — hosts our database and handles authentication.</li>
            <li><strong className="text-foreground">Vercel</strong> — hosts the application.</li>
            <li><strong className="text-foreground">Stripe</strong> — processes subscription payments.</li>
            <li><strong className="text-foreground">GoHighLevel (optional)</strong> — if you enable CRM dispatch in Settings, qualified lead details are sent to your connected GoHighLevel account.</li>
          </ul>
          <p className="mt-2">We do not sell your personal information to anyone.</p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">5. Data Retention</h2>
          <p>
            We retain your account and business data for as long as your account is active. Scraped post
            data and opportunities are retained until you delete them or they are removed by an automated
            cleanup you configure. You can request deletion of your account and associated data at any
            time.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">6. Data Security</h2>
          <p>
            Your data is isolated at the database level so that other customers cannot access it — every
            table enforcing row-level security scoped to your account. Data is encrypted in transit.
            Sensitive credentials (API keys, service tokens) are never exposed to the browser.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">7. Your Rights</h2>
          <p>
            You may access, correct, or request deletion of your personal information at any time by
            contacting us. If you are located in a jurisdiction with additional statutory privacy rights
            (such as the EU/UK GDPR or Canada&apos;s PIPEDA), those rights apply to you in addition to
            what&apos;s described here.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">8. Cookies</h2>
          <p>
            We use essential cookies to keep you signed in. We do not use third-party advertising or
            tracking cookies.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">9. Children&apos;s Privacy</h2>
          <p>The Service is intended for business use by adults and is not directed at children under 18.</p>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-lg font-semibold text-foreground">10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Material changes will be communicated to
            active subscribers before they take effect.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">11. Contact</h2>
          <p>
            Questions about this Privacy Policy, or requests to access or delete your data, can be sent to
            the email address you use to communicate with your Floozy contact. See also our{" "}
            <Link href="/terms" className="text-brand underline decoration-dotted underline-offset-4 hover:text-brand/80">
              Terms of Service
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  )
}
