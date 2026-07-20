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