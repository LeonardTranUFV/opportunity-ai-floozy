import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

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

export async function GET() {
  const supabase = await createClient();
  try {
    const { data: agents, error } = await supabase
      .from('agents')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, agents });
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch agents' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  try {
    const { id } = await request.json();
    if (id === undefined) {
      return NextResponse.json({ success: false, error: 'Agent id is required' }, { status: 400 });
    }

    await supabase.from('opportunities').delete().eq('agent_id', id);
    const { error, count } = await supabase.from('agents').delete({ count: 'exact' }).eq('id', id);

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
