import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    customerName TEXT,
    phoneNumber TEXT,
    notes TEXT,
    fileName TEXT,
    fileType TEXT,
    fileSize INTEGER,
    uploadDate TEXT,
    status TEXT,
    serverFileName TEXT,
    pageCount INTEGER,
    colorMode TEXT,
    copies INTEGER
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

/**
 * Settings Helpers
 */
export const getSettings = () => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach(row => {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch (e) {
      settings[row.key] = row.value;
    }
  });
  return settings;
};

export const updateSetting = (key, value) => {
  const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, serializedValue);
};

export default db;
