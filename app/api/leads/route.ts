import { NextResponse } from 'next/server';
import db from '@/lib/db';

// GET all qualified leads
export async function GET() {
  try {
    const leads = db.prepare(`
      SELECT leads.*, posts.raw_text, posts.timestamp as post_timestamp
      FROM leads 
      JOIN posts ON leads.post_id = posts.id 
      ORDER BY leads.created_at DESC
    `).all();
    
    return NextResponse.json(leads);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Helper to push approved lead to GoHighLevel
async function dispatchToGHL(lead: any) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;

  if (!apiKey || !locationId) {
    console.warn('⚠️ GHL Dispatch Skipped: GHL_API_KEY or GHL_LOCATION_ID is not defined in .env');
    return { success: false, reason: 'GHL environment variables missing in dashboard .env.' };
  }

  // Split name into first and last name
  const nameParts = (lead.author_name || 'Social Lead').trim().split(/\s+/);
  const firstName = nameParts[0] || 'Social';
  const lastName = nameParts.slice(1).join(' ') || 'Lead';

  // Format tags cleanly
  const tags = [
    'Floozy-Social-Lead',
    `trade-${lead.trade_category}`,
    `urgency-${lead.urgency}`
  ];

  const payload = {
    firstName,
    lastName,
    phone: lead.phone_number || undefined,
    locationId: locationId,
    tags,
    source: 'Floozy Social Monitor',
    customFields: []
  };

  try {
    console.log(`📡 Dispatching contact to GoHighLevel for lead: ${lead.author_name}...`);
    
    const response = await fetch('https://services.leadconnectorhq.com/contacts/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`✅ GHL Contact created/updated successfully for ${lead.author_name} (ID: ${data.contact?.id})`);
      
      // If we have an opportunity pipeline, we could optionally trigger it here.
      // But adding contact + tags is the most robust way to trigger pre-built GHL Workflows!
      return { success: true, contactId: data.contact?.id };
    } else {
      const errText = await response.text();
      console.error(`❌ GHL Dispatch Failed: ${response.status} - ${errText}`);
      return { success: false, reason: `GHL API responded with ${response.status}: ${errText}` };
    }
  } catch (error: any) {
    console.error(`❌ GHL Dispatch Fetch Error: ${error.message}`);
    return { success: false, reason: error.message };
  }
}

// POST to manually add a lead from the raw posts feed
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { postId } = body;

    if (!postId) {
      return NextResponse.json({ error: 'Post ID is required.' }, { status: 400 });
    }

    // Check if post exists
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId) as any;
    if (!post) {
      return NextResponse.json({ error: 'Post not found.' }, { status: 404 });
    }

    // Check if lead already exists
    const existingLead = db.prepare('SELECT id FROM leads WHERE post_id = ?').get(postId);
    if (existingLead) {
      return NextResponse.json({ error: 'Lead already exists for this post.' }, { status: 409 });
    }

    // Insert generic manual lead
    const insertLeadStmt = db.prepare(`
      INSERT INTO leads (post_id, platform, post_url, author_name, author_profile_url, trade_category, service_summary, location_mentioned, urgency, phone_number, confidence_score, suggested_public_comment, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = insertLeadStmt.run(
      post.id,
      post.platform,
      post.post_url,
      post.author_name,
      post.author_profile_url,
      'other',
      'Manually flagged lead from raw posts feed.',
      null,
      'medium',
      null,
      1.0,
      'Hello! We can help with this. Sending you a DM with our details.',
      'pending'
    );

    const newLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);
    return NextResponse.json({ success: true, lead: newLead });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT to update a lead's status, phone, or comment
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, status, phone_number, suggested_public_comment } = body;

    if (id === undefined) {
      return NextResponse.json({ error: 'Lead ID is required.' }, { status: 400 });
    }

    // 1. Fetch current lead state
    const currentLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as any;
    if (!currentLead) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    }

    // 2. Apply database updates first
    if (status !== undefined) {
      db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, id);
    }

    if (phone_number !== undefined) {
      db.prepare('UPDATE leads SET phone_number = ? WHERE id = ?').run(phone_number, id);
    }

    if (suggested_public_comment !== undefined) {
      db.prepare('UPDATE leads SET suggested_public_comment = ? WHERE id = ?').run(suggested_public_comment, id);
    }

    const updatedLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as any;

    // 3. If we are marking the lead as 'approved', trigger GHL dispatch!
    let ghlResult = null;
    if (status === 'approved' && currentLead.status !== 'approved') {
      ghlResult = await dispatchToGHL(updatedLead);
    }

    return NextResponse.json({ 
      success: true, 
      lead: updatedLead,
      ghl: ghlResult 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
