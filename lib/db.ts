import Database from 'better-sqlite3';
import path from 'path';

// Define the database path in the project root
const dbPath = path.join(process.cwd(), 'leads.db');

// Extend global namespace to cache the DB connection in development
interface GlobalWithDb {
  db?: Database.Database;
}

let db: Database.Database;

if (process.env.NODE_ENV === 'production') {
  db = new Database(dbPath);
} else {
  const globalWithDb = global as unknown as GlobalWithDb;
  if (!globalWithDb.db) {
    globalWithDb.db = new Database(dbPath);
  }
  db = globalWithDb.db;
}

// Automatically create tables on database load
function initDb() {
  // 1. Create Groups table
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Create Posts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER,
      platform TEXT NOT NULL,
      post_id TEXT UNIQUE,
      post_url TEXT,
      author_name TEXT NOT NULL,
      author_profile_url TEXT,
      timestamp TEXT,
      raw_text TEXT NOT NULL,
      scraped_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
    );
  `);

  // 4. Create Settings table for Dynamic AI Personas
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default settings if empty
  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number };
  if (settingsCount.count === 0) {
    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insertSetting.run('ai_goal', 'home_services');
    insertSetting.run('ai_languages', 'English, Vietnamese (Tiếng Việt)');
    insertSetting.run('ai_custom_rules', 'Look for people needing help. Be polite and helpful. If they speak Vietnamese, draft the comment in Vietnamese.');
  }
}

initDb();

export default db;
