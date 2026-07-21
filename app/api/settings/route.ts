import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  try {
    const { data: rows, error } = await supabase.from('settings').select('key, value');
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();

    const rows = Object.entries(body)
      .filter(([, value]) => typeof value === 'string')
      .map(([key, value]) => ({ user_id: user.id, key, value: value as string }));

    if (rows.length > 0) {
      const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'user_id,key' });
      if (error) throw error;
    }

    const { data: settingsRows, error: fetchError } = await supabase.from('settings').select('key, value');
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
