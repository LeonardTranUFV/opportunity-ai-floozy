import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getSourceCapacity,
  countsTowardSourceLimit,
  sourceLimitMessage,
} from '@/lib/entitlement';

// GET the caller's own groups. The auth check is the second lock behind RLS —
// a handler that returns rows to an anonymous caller and relies entirely on a
// database policy to make that list empty is one migration away from leaking.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
      .from('groups')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
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

    // Checked before inserting, not after: a source that lands in the table
    // and is then switched off would still show as something the customer
    // added, and they would have to work out why it is inert.
    //
    // Only when it starts active. Adding a source switched off is free — it
    // costs nothing until somebody turns it on, and that is the moment this
    // same check runs again in PUT.
    const startsActive = active ?? true;
    if (startsActive && countsTowardSourceLimit(platform)) {
      const capacity = await getSourceCapacity(supabase, user.id);
      if (capacity.remaining < 1) {
        return NextResponse.json(
          { error: sourceLimitMessage(capacity), limit: capacity.limit, used: capacity.used },
          { status: 409 }
        );
      }
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, active, name, url } = body;

    if (id === undefined) {
      return NextResponse.json({ error: 'Group ID is required.' }, { status: 400 });
    }

    // Switching a source ON is the only update that can exceed the limit.
    // Pausing, renaming and re-pointing stay allowed — a customer at their
    // limit must never be blocked from the action that gets them back under it.
    if (active === true) {
      const { data: target } = await supabase
        .from('groups')
        .select('platform, active')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

      // Already on means a re-save, not a new source. Counting that would make
      // the last allowed source impossible to rename.
      if (target && !target.active && countsTowardSourceLimit(target.platform)) {
        const capacity = await getSourceCapacity(supabase, user.id);
        if (capacity.remaining < 1) {
          return NextResponse.json(
            { error: sourceLimitMessage(capacity), limit: capacity.limit, used: capacity.used },
            { status: 409 }
          );
        }
      }
    }

    const updates: Record<string, unknown> = {};
    if (active !== undefined) updates.active = active;
    if (name !== undefined) updates.name = name;
    if (url !== undefined) updates.url = url;

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from('groups')
        .update(updates)
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
    }

    const { data: updatedGroup, error: fetchError } = await supabase
      .from('groups')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id } = body;

    if (id === undefined) {
      return NextResponse.json({ error: 'Group ID is required.' }, { status: 400 });
    }

    const { error, count } = await supabase
      .from('groups')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('user_id', user.id);
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
