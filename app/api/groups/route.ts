import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET all groups
export async function GET() {
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.from('groups').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch groups';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST a new group
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
    const { platform, name, url, active } = body;

    if (!platform || !name || !url) {
      return NextResponse.json({ error: 'Platform, name, and url are required.' }, { status: 400 });
    }

    // Strip glued-on activity metadata that Facebook includes in scraped link text
    const cleanName = String(name).replace(/Last active.*$/i, '').replace(/\s{2,}/g, ' ').trim() || name;

    const { data, error } = await supabase
      .from('groups')
      .insert({ user_id: user.id, platform, name: cleanName, url, active: active ?? true })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A group with this URL already exists.' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add group';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT to update a group (active toggle or details)
export async function PUT(request: Request) {
  const supabase = await createClient();
  try {
    const body = await request.json();
    const { id, active, name, url } = body;

    if (id === undefined) {
      return NextResponse.json({ error: 'Group ID is required.' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (active !== undefined) updates.active = active;
    if (name !== undefined) updates.name = name;
    if (url !== undefined) updates.url = url;

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('groups').update(updates).eq('id', id);
      if (error) throw error;
    }

    const { data: updatedGroup, error: fetchError } = await supabase
      .from('groups')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchError) throw fetchError;

    return NextResponse.json(updatedGroup);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update group';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE a group (posts keep their history; group_id becomes NULL via FK rule)
export async function DELETE(request: Request) {
  const supabase = await createClient();
  try {
    const body = await request.json();
    const { id } = body;

    if (id === undefined) {
      return NextResponse.json({ error: 'Group ID is required.' }, { status: 400 });
    }

    const { error, count } = await supabase.from('groups').delete({ count: 'exact' }).eq('id', id);
    if (error) throw error;
    if (!count) {
      return NextResponse.json({ error: 'Group not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted: id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete group';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
