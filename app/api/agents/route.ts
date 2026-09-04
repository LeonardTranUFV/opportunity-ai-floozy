import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, tooManyRequests, LIMITS } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  const rl = await rateLimit(`agents-add:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "agents created");

  try {
    const body = await request.json();
    const { name, goal, location, keywords, negative_keywords } = body;

    const { data, error } = await supabase
      .from('agents')
      .insert({ user_id: user.id, name, goal, location, keywords, negative_keywords })
      .select('id')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error('Error saving agent:', error);
    return NextResponse.json({ success: false, error: 'Failed to save agent' }, { status: 500 });
  }
}

// RLS already scopes every query below to the caller, and the policies on
// `agents` are correct. This check is the second lock, not the first: without
// it, the only thing standing between an anonymous request and every user's
// agents is one `alter table ... enable row level security` staying switched
// on. Handlers should fail closed on their own.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  const rl = await rateLimit(`agents-read:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "requests");

  try {
    const { data: agents, error } = await supabase
      .from('agents')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, agents });
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch agents' }, { status: 500 });
  }
}

// Deletes an agent *and every opportunity it found*, addressed only by an id
// taken from the request body. That is a lot of destruction to hang on a single
// RLS policy, so this checks the session and scopes both deletes to the
// caller's own rows explicitly.
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  const rl = await rateLimit(`agents-delete:${user.id}`, LIMITS.standard.limit, LIMITS.standard.windowMs);
  if (!rl.allowed) return tooManyRequests(rl, "deletions");

  try {
    const { id } = await request.json();
    if (id === undefined) {
      return NextResponse.json({ success: false, error: 'Agent id is required' }, { status: 400 });
    }

    await supabase.from('opportunities').delete().eq('agent_id', id).eq('user_id', user.id);
    const { error, count } = await supabase
      .from('agents')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;
    if (!count) {
      return NextResponse.json({ success: false, error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted: id });
  } catch (error) {
    console.error('Error deleting agent:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete agent' }, { status: 500 });
  }
}
