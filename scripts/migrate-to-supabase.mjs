// One-time migration: local SQLite (leads.db + opportunity.db) -> Supabase Postgres.
// Uses the service_role key to bypass RLS since this runs outside a user session.
//
// Usage: node scripts/migrate-to-supabase.mjs you@example.com

import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env") });

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/migrate-to-supabase.mjs you@example.com");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const leadsDb = new Database(path.join(__dirname, "..", "leads.db"));
const oppDb = new Database(path.join(__dirname, "..", "opportunity.db"));

const STATUS_MAP = { pending: "new", approved: "qualified", rejected: "lost" };

async function findUserId() {
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) break;
    page++;
  }
  throw new Error(`No Supabase user found with email ${email}. Sign up first at /login.`);
}

async function main() {
  const userId = await findUserId();
  console.log(`Migrating data to user ${email} (${userId})\n`);

  // ---- groups ----
  const groupIdMap = new Map(); // sqlite int id -> postgres uuid
  const groups = leadsDb.prepare("SELECT * FROM groups").all();
  for (const g of groups) {
    const { data, error } = await supabase
      .from("groups")
      .upsert(
        {
          user_id: userId,
          platform: g.platform,
          name: g.name,
          url: g.url,
          active: !!g.active,
          created_at: g.created_at,
        },
        { onConflict: "user_id,url" }
      )
      .select("id")
      .single();
    if (error) throw new Error(`group ${g.id}: ${error.message}`);
    groupIdMap.set(g.id, data.id);
  }
  console.log(`✓ groups: ${groups.length}`);

  // ---- posts ----
  const postIdMap = new Map(); // sqlite int id -> postgres uuid
  const posts = leadsDb.prepare("SELECT * FROM posts").all();
  for (const p of posts) {
    const { data, error } = await supabase
      .from("posts")
      .upsert(
        {
          user_id: userId,
          group_id: p.group_id ? groupIdMap.get(p.group_id) ?? null : null,
          platform: p.platform,
          external_post_id: p.post_id,
          post_url: p.post_url,
          author_name: p.author_name,
          author_profile_url: p.author_profile_url,
          posted_at: p.timestamp,
          raw_text: p.raw_text,
          scraped_at: p.scraped_at,
        },
        { onConflict: "user_id,external_post_id" }
      )
      .select("id")
      .single();
    if (error) throw new Error(`post ${p.id}: ${error.message}`);
    postIdMap.set(p.id, data.id);
  }
  console.log(`✓ posts: ${posts.length}`);

  // ---- settings ----
  const settings = leadsDb.prepare("SELECT * FROM settings").all();
  for (const s of settings) {
    const { error } = await supabase
      .from("settings")
      .upsert(
        { user_id: userId, key: s.key, value: s.value, updated_at: s.updated_at },
        { onConflict: "user_id,key" }
      );
    if (error) throw new Error(`setting ${s.key}: ${error.message}`);
  }
  console.log(`✓ settings: ${settings.length}`);

  // ---- agents (from opportunity.db) ----
  const agentIdMap = new Map();
  const agents = oppDb.prepare("SELECT * FROM agents").all();
  for (const a of agents) {
    const { data, error } = await supabase
      .from("agents")
      .insert({
        user_id: userId,
        name: a.name,
        goal: a.goal,
        location: a.location,
        keywords: a.keywords,
        negative_keywords: a.negative_keywords,
        created_at: a.created_at,
      })
      .select("id")
      .single();
    if (error) throw new Error(`agent ${a.id}: ${error.message}`);
    agentIdMap.set(a.id, data.id);
  }
  console.log(`✓ agents: ${agents.length}`);

  // Legacy leads (leads.db) don't belong to any new-style agent — create one
  // "Legacy Import" agent to hold them so they still show up in the pipeline.
  const legacyLeads = leadsDb.prepare("SELECT * FROM leads").all();
  let legacyAgentId = null;
  if (legacyLeads.length > 0) {
    const { data, error } = await supabase
      .from("agents")
      .insert({
        user_id: userId,
        name: "Legacy Floozy Import",
        goal: "Historical leads migrated from the original Floozy scraper.",
      })
      .select("id")
      .single();
    if (error) throw new Error(`legacy agent: ${error.message}`);
    legacyAgentId = data.id;
  }

  // ---- opportunities (from opportunity.db) ----
  const opportunities = oppDb.prepare("SELECT * FROM opportunities").all();
  for (const o of opportunities) {
    const { error } = await supabase.from("opportunities").insert({
      user_id: userId,
      agent_id: o.agent_id ? agentIdMap.get(o.agent_id) ?? null : null,
      source_post_id: o.source_post_id ? postIdMap.get(o.source_post_id) ?? null : null,
      platform: o.platform,
      author_name: o.author_name,
      author_profile_url: o.author_profile_url,
      post_url: o.post_url,
      location_mentioned: o.location_mentioned,
      phone_number: o.phone_number,
      content: o.content,
      category: o.category,
      intent_score: o.intent_score,
      urgency: o.urgency,
      estimated_value: o.estimated_value,
      ai_summary: o.ai_summary,
      suggested_reply: o.suggested_reply,
      status: o.status,
      created_at: o.created_at,
    });
    if (error) throw new Error(`opportunity ${o.id}: ${error.message}`);
  }
  console.log(`✓ opportunities: ${opportunities.length}`);

  // ---- legacy leads -> opportunities ----
  const getPostText = leadsDb.prepare("SELECT raw_text FROM posts WHERE id = ?");
  for (const lead of legacyLeads) {
    const post = lead.post_id ? getPostText.get(lead.post_id) : null;
    const { error } = await supabase.from("opportunities").insert({
      user_id: userId,
      agent_id: legacyAgentId,
      source_post_id: lead.post_id ? postIdMap.get(lead.post_id) ?? null : null,
      platform: lead.platform,
      author_name: lead.author_name,
      author_profile_url: lead.author_profile_url,
      post_url: lead.post_url,
      location_mentioned: lead.location_mentioned,
      phone_number: lead.phone_number,
      content: post?.raw_text || lead.service_summary,
      category: lead.trade_category,
      intent_score: Math.round((lead.confidence_score ?? 0) * 100),
      urgency: lead.urgency,
      estimated_value: null,
      ai_summary: lead.service_summary,
      suggested_reply: lead.suggested_public_comment,
      status: STATUS_MAP[lead.status] ?? "new",
      created_at: lead.created_at,
    });
    if (error) throw new Error(`legacy lead ${lead.id}: ${error.message}`);
  }
  console.log(`✓ legacy leads -> opportunities: ${legacyLeads.length}`);

  // ---- evaluated_posts ----
  const evaluated = oppDb.prepare("SELECT * FROM evaluated_posts").all();
  let evaluatedSkipped = 0;
  for (const e of evaluated) {
    const agentId = agentIdMap.get(e.agent_id);
    const postId = postIdMap.get(e.source_post_id);
    if (!agentId || !postId) {
      evaluatedSkipped++;
      continue;
    }
    const { error } = await supabase
      .from("evaluated_posts")
      .upsert(
        { user_id: userId, agent_id: agentId, source_post_id: postId, evaluated_at: e.evaluated_at },
        { onConflict: "agent_id,source_post_id" }
      );
    if (error) throw new Error(`evaluated_post: ${error.message}`);
  }
  console.log(`✓ evaluated_posts: ${evaluated.length - evaluatedSkipped} (${evaluatedSkipped} skipped, missing refs)`);

  console.log("\nMigration complete.");
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message);
  process.exit(1);
});
