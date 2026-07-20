import { NextResponse } from 'next/server';
import db from '@/lib/db';

// GET all groups
export async function GET() {
  try {
    const groups = db.prepare('SELECT * FROM groups ORDER BY created_at DESC').all();
    return NextResponse.json(groups);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST a new group
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { platform, name, url, active } = body;

    if (!platform || !name || !url) {
      return NextResponse.json({ error: 'Platform, name, and url are required.' }, { status: 400 });
    }

    // Strip glued-on activity metadata that Facebook includes in scraped link text
    const cleanName = String(name).replace(/Last active.*$/i, '').replace(/\s{2,}/g, ' ').trim() || name;

    const info = db.prepare(
      'INSERT INTO groups (platform, name, url, active) VALUES (?, ?, ?, ?)'
    ).run(platform, cleanName, url, active !== undefined ? (active ? 1 : 0) : 1);

    const newGroup = db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid);
    return NextResponse.json(newGroup);
  } catch (error: any) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return NextResponse.json({ error: 'A group with this URL already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT to update a group (active toggle or details)
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, active, name, url } = body;

    if (id === undefined) {
      return NextResponse.json({ error: 'Group ID is required.' }, { status: 400 });
    }

    if (active !== undefined) {
      db.prepare('UPDATE groups SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    }

    if (name !== undefined && url !== undefined) {
      db.prepare('UPDATE groups SET name = ?, url = ? WHERE id = ?').run(name, url, id);
    }

    const updatedGroup = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    return NextResponse.json(updatedGroup);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE a group (posts keep their history; group_id becomes NULL via FK rule)
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { id } = body;

    if (id === undefined) {
      return NextResponse.json({ error: 'Group ID is required.' }, { status: 400 });
    }

    const info = db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    if (info.changes === 0) {
      return NextResponse.json({ error: 'Group not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted: id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
