import Database from 'better-sqlite3';
import path from 'path';

// For the MVP, we use SQLite before transitioning to PostgreSQL
const dbPath = path.join(process.cwd(), 'opportunity.db');
export const db = new Database(dbPath);

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
    platform TEXT,
    author_name TEXT,
    content TEXT NOT NULL,
    intent_score INTEGER,
    urgency TEXT,
    estimated_value TEXT,
    ai_summary TEXT,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(agent_id) REFERENCES agents(id)
  );
`);