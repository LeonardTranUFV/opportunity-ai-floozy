import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";

// Settings can hold connected-account details, so this fails closed rather than
// trusting RLS alone to keep one user's keys out of another's session.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const rl = await rateLimit(`settings-read:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "requests");

  try {
    const { data: rows, error } = await supabase
      .from('settings')
      .select('key, value')
      .eq('user_id', user.id);
    if (error) throw error;

    const settingsMap = (rows ?? []).reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);

    return NextResponse.json(settingsMap);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * The only keys this route will write.
 *
 * Defence in depth rather than the main control: `settings` also holds
 * consent records and, until this change, privilege flags, and the browser
 * holds an anon key that RLS lets write the table directly. The real fix was
 * moving privilege out of the table entirely (lib/privileges.ts). This stops
 * *this* route from being the easy way to write a key nobody intended, and
 * makes the set of things a form may save explicit.
 *
 * Consent and pool opt-in are absent on purpose: they are written by
 * lib/consent.ts, which records a version and a timestamp alongside them, and
 * must not be settable as a bare string.
 */
const WRITABLE_KEYS = new Set([
  "ai_goal",
  "ai_languages",
  "ai_custom_rules",
  "business_owner_name",
  "business_name",
  "business_phone",
  "business_pitch",
  "ghl_dispatch_enabled",
  "privacy_mode",
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const rl = await rateLimit(`settings-write:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "saves");

  try {
    const body = await request.json();

    const submitted = Object.entries(body).filter(([, value]) => typeof value === 'string');
    const rejected = submitted.filter(([key]) => !WRITABLE_KEYS.has(key)).map(([key]) => key);
    if (rejected.length > 0) {
      // Named rather than silently dropped: a form posting a key this route
      // does not accept is a bug worth seeing, and an attempt to write one is
      // worth having in the log.
      console.warn(`[settings] refused write to non-writable key(s): ${rejected.join(', ')}`);
      return NextResponse.json(
        { error: `These settings can't be changed here: ${rejected.join(', ')}.` },
        { status: 400 }
      );
    }

    const rows = submitted.map(([key, value]) => ({ user_id: user.id, key, value: value as string }));

    if (rows.length > 0) {
      const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'user_id,key' });
      if (error) throw error;
    }

    const { data: settingsRows, error: fetchError } = await supabase
      .from('settings')
      .select('key, value')
      .eq('user_id', user.id);
    if (fetchError) throw fetchError;

    const settingsMap = (settingsRows ?? []).reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);

    return NextResponse.json({ success: true, settings: settingsMap });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
