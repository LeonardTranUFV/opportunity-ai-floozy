import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { posts } = body; // Expects an array of post objects: { group_url, platform, post_id, post_url, author_name, author_profile_url, timestamp, raw_text, lead: { ... } }

    if (!posts || !Array.isArray(posts)) {
      return NextResponse.json({ error: 'An array of "posts" is required in the body.' }, { status: 400 });
    }

    const results = {
      received: posts.length,
      inserted_posts: 0,
      inserted_leads: 0,
      errors: [] as string[]
    };

    // Prepare DB statements
    const findGroupStmt = db.prepare('SELECT id FROM groups WHERE url = ?');
    const insertPostStmt = db.prepare(`
      INSERT INTO posts (group_id, platform, post_id, post_url, author_name, author_profile_url, timestamp, raw_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET raw_text=excluded.raw_text
    `);
    const insertLeadStmt = db.prepare(`
      INSERT INTO leads (post_id, platform, post_url, author_name, author_profile_url, trade_category, service_summary, location_mentioned, urgency, phone_number, confidence_score, suggested_public_comment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id) DO UPDATE SET
        trade_category=excluded.trade_category,
        service_summary=excluded.service_summary,
        location_mentioned=excluded.location_mentioned,
        urgency=excluded.urgency,
        phone_number=excluded.phone_number,
        confidence_score=excluded.confidence_score,
        suggested_public_comment=excluded.suggested_public_comment
    `);

    // Run transaction
    const transaction = db.transaction(() => {
      for (const item of posts) {
        try {
          // 1. Find group_id by URL if group_url is provided
          let groupId: number | null = null;
          if (item.group_url) {
            const grp = findGroupStmt.get(item.group_url) as { id: number } | undefined;
            if (grp) groupId = grp.id;
          }

          // 2. Insert Post
          insertPostStmt.run(
            groupId,
            item.platform || 'facebook',
            item.post_id,
            item.post_url || null,
            item.author_name,
            item.author_profile_url || null,
            item.timestamp || null,
            item.raw_text
          );

          results.inserted_posts++;

          // 3. If there is a qualified lead object from Gemini attached, insert/update the lead
          if (item.lead) {
            // Always resolve the row id by post_id: on the ON CONFLICT DO UPDATE
            // path, lastInsertRowid is stale and would link the lead to the wrong post.
            const postRow = db.prepare('SELECT id FROM posts WHERE post_id = ?').get(item.post_id) as { id: number } | undefined;
            if (!postRow) {
              results.errors.push(`Post ID ${item.post_id}: could not resolve post row for lead.`);
              continue;
            }

            insertLeadStmt.run(
              postRow.id,
              item.platform || 'facebook',
              item.post_url || null,
              item.author_name,
              item.author_profile_url || null,
              item.lead.trade_category,
              item.lead.service_summary,
              item.lead.location_mentioned || null,
              item.lead.urgency,
              item.lead.phone_number || null,
              item.lead.confidence_score,
              item.lead.suggested_public_comment
            );
            results.inserted_leads++;
          }
        } catch (err: any) {
          results.errors.push(`Post ID ${item.post_id}: ${err.message}`);
        }
      }
    });

    transaction();

    return NextResponse.json({ success: true, ...results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
