import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConsent, recordConsent, setPoolOptIn, TERMS_VERSION } from "@/lib/consent";
import { readJsonBody, validationErrorResponse } from "@/lib/validate";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const consent = await getConsent(supabase, user.id);
  return NextResponse.json({ ...consent, requiredVersion: TERMS_VERSION });
}

/**
 * Records acceptance of the current terms, plus the separate, optional pool
 * opt-in.
 *
 * `accepted` must be explicitly true. There is no default and no way to accept
 * by omission — a consent the user did not actively give is not a consent, and
 * this is the record we would produce if it were ever questioned.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    return validationErrorResponse(err) ?? NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const { accepted, poolOptIn, onlyPool } = body as {
    accepted?: unknown;
    poolOptIn?: unknown;
    onlyPool?: unknown;
  };

  // The Settings toggle flips the pool without re-accepting the terms.
  if (onlyPool === true) {
    const { error } = await setPoolOptIn(supabase, user.id, poolOptIn === true);
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ ok: true, poolOptIn: poolOptIn === true });
  }

  if (accepted !== true) {
    return NextResponse.json(
      { error: "You must accept the Terms of Service and Privacy Policy to continue." },
      { status: 400 }
    );
  }

  const { error } = await recordConsent(supabase, user.id, poolOptIn === true);
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ ok: true, version: TERMS_VERSION, poolOptIn: poolOptIn === true });
}
