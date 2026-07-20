import { NextResponse } from 'next/server';
import { db } from '@/lib/db/schema';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, goal, location, keywords, negative_keywords } = body;

    const stmt = db.prepare(`
      INSERT INTO agents (name, goal, location, keywords, negative_keywords)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(name, goal, location, keywords, negative_keywords);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Error saving agent:', error);
    return NextResponse.json({ success: false, error: 'Failed to save agent' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const stmt = db.prepare('SELECT * FROM agents ORDER BY created_at DESC');
    const agents = stmt.all();
    return NextResponse.json({ success: true, agents });
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch agents' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { id } = await request.json();
    if (id === undefined) {
      return NextResponse.json({ success: false, error: 'Agent id is required' }, { status: 400 });
    }

    db.prepare('DELETE FROM opportunities WHERE agent_id = ?').run(id);
    const result = db.prepare('DELETE FROM agents WHERE id = ?').run(id);

    if (result.changes === 0) {
      return NextResponse.json({ success: false, error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted: id });
  } catch (error) {
    console.error('Error deleting agent:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete agent' }, { status: 500 });
  }
}