import { NextResponse } from "next/server";
import { generateWebsiteReport, type WebsiteCheck } from "@/lib/ai";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const rawUrl = (body.url || "").trim();

  if (!rawUrl) {
    return NextResponse.json({ success: false, error: "A URL is required" }, { status: 400 });
  }

  const targetUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  const startTime = Date.now();
  let response: Response;
  try {
    response = await fetch(targetUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OpportunityAI-Scanner/1.0)" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach the site";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
  const loadTimeMs = Date.now() - startTime;

  const html = await response.text();
  const finalUrl = response.url || targetUrl;
  const isHttps = finalUrl.startsWith("https://");
  const hasViewportMeta = /<meta[^>]+name=["']viewport["']/i.test(html);
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const hasTitle = !!titleMatch && titleMatch[1].trim().length > 2;
  const hasMetaDescription = /<meta[^>]+name=["']description["']/i.test(html);
  const hasContactMethod = /mailto:|tel:|<form/i.test(html);
  const hasBookingKeyword = /book now|schedule|appointment|book online/i.test(html);

  const checks: WebsiteCheck[] = [
    {
      label: "HTTPS / SSL",
      pass: isHttps,
      detail: isHttps
        ? "Site loads securely over HTTPS."
        : "Site is not using HTTPS — this hurts trust and search ranking.",
    },
    {
      label: "Mobile viewport tag",
      pass: hasViewportMeta,
      detail: hasViewportMeta
        ? "Has a responsive viewport meta tag."
        : "Missing viewport meta tag — likely not mobile-optimized.",
    },
    {
      label: "Page title",
      pass: hasTitle,
      detail: hasTitle ? `Title found: "${titleMatch?.[1]?.trim()}"` : "Missing or empty <title> tag.",
    },
    {
      label: "Meta description",
      pass: hasMetaDescription,
      detail: hasMetaDescription
        ? "Has a meta description for search results."
        : "Missing meta description — hurts click-through from search.",
    },
    {
      label: "Contact method",
      pass: hasContactMethod,
      detail: hasContactMethod
        ? "Found a phone/email link or a contact form."
        : "No obvious phone, email, or contact form detected.",
    },
    {
      label: "Booking / scheduling",
      pass: hasBookingKeyword,
      detail: hasBookingKeyword
        ? "Mentions online booking or scheduling."
        : "No online booking or scheduling detected.",
    },
    {
      label: "Response speed",
      pass: loadTimeMs < 3000,
      detail: `Page responded in ${loadTimeMs}ms${loadTimeMs >= 3000 ? " — this is slow and may lose visitors." : "."}`,
    },
  ];

  const score = Math.round((checks.filter((c) => c.pass).length / checks.length) * 100);

  let aiReport: string | null = null;
  let aiError: string | null = null;
  try {
    aiReport = await generateWebsiteReport(finalUrl, checks);
  } catch (error) {
    aiError = error instanceof Error ? error.message : "AI report generation failed";
  }

  return NextResponse.json({
    success: true,
    url: finalUrl,
    statusCode: response.status,
    loadTimeMs,
    score,
    checks,
    aiReport,
    aiError,
  });
}
