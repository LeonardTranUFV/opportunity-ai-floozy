import Database from 'better-sqlite3';
import path from 'path';

// For the MVP, we use SQLite before transitioning to PostgreSQL
const dbPath = path.join(process.cwd(), 'opportunity.db');
export const db = new Database(dbPath);

// Migrate the opportunities table to the richer schema if an old empty version exists
const existingOpportunitiesTable = db
  .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'opportunities'`)
  .get() as { sql: string } | undefined;

if (existingOpportunitiesTable && !existingOpportunitiesTable.sql.includes('source_post_id')) {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM opportunities').get() as { count: number };
  if (count === 0) {
    db.exec('DROP TABLE opportunities');
  } else {
    throw new Error(
      'opportunities table has an outdated schema and contains data — manual migration required instead of auto-drop.'
    );
  }
}

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    goal TEXT NOT NULL,
    location TEXT,
    keywords TEXT,
    negative_keywords TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER,
    source_post_id INTEGER,
    platform TEXT,
    author_name TEXT,
    author_profile_url TEXT,
    post_url TEXT,
    location_mentioned TEXT,
    content TEXT NOT NULL,
    category TEXT,
    intent_score INTEGER,
    urgency TEXT,
    estimated_value TEXT,
    ai_summary TEXT,
    suggested_reply TEXT,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(agent_id) REFERENCES agents(id)
  );

  CREATE TABLE IF NOT EXISTS evaluated_posts (
    agent_id INTEGER NOT NULL,
    source_post_id INTEGER NOT NULL,
    evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_id, source_post_id)
  );
`);