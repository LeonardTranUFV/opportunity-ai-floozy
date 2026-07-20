import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const posts = db.prepare(`
      SELECT posts.*, groups.name as group_name 
      FROM posts 
      LEFT JOIN groups ON posts.group_id = groups.id 
      ORDER BY posts.scraped_at DESC
    `).all();
    
    return NextResponse.json(posts);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
