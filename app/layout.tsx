import type { Metadata } from "next";
import { Geist, Geist_Mono, Archivo } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { siteUrl } from "@/lib/site-url";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face. Geist alone is Vercel's Next.js default — it reads as
// unstyled rather than chosen. Archivo is a grotesque with real presence at
// heavy weights and a slightly condensed, workmanlike feel that suits a tool
// used by trades on a job site. Body copy stays on Geist for legibility at
// small sizes; Archivo is used only for headings and figures.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// `metadataBase` has to be absolute or Next resolves OG/canonical URLs against
// the request host, which on Vercel means preview deployments advertise
// themselves as the canonical site.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Opportunity AI — find the people already asking for what you sell",
    template: "%s · Opportunity AI",
  },
  description:
    "Opportunity AI reads the groups and feeds your customers already post in, and tells you which posts are real buying intent. Set a goal in plain language; the agent scores every post and hands you the ones worth answering.",
  applicationName: "Opportunity AI",
  keywords: [
    "AI lead generation",
    "buying intent",
    "opportunity intelligence",
    "contractor leads",
    "social listening",
    "AI sales agent",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Opportunity AI",
    url: "/",
    title: "Find the people already asking for what you sell",
    description:
      "An AI agent that reads the feeds your customers post in and scores every post for real buying intent.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Find the people already asking for what you sell",
    description:
      "An AI agent that reads the feeds your customers post in and scores every post for real buying intent.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable}`} suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
