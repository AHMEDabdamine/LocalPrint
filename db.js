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

  CREATE TABLE IF NOT EXISTS discount_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    discount_type TEXT NOT NULL,
    discount_value REAL NOT NULL,
    condition_type TEXT NOT NULL,
    threshold INTEGER NOT NULL,
    max_discount_cap REAL,
    priority INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

/**
 * Discount Rules Helpers
 */
export const getDiscountRules = () => {
  const rows = db.prepare('SELECT * FROM discount_rules ORDER BY priority DESC, created_at DESC').all();
  return rows.map(row => ({
    ...row,
    is_active: Boolean(row.is_active)
  }));
};

export const getActiveDiscountRules = () => {
  const rows = db.prepare('SELECT * FROM discount_rules WHERE is_active = 1 ORDER BY priority DESC').all();
  return rows.map(row => ({
    ...row,
    is_active: Boolean(row.is_active)
  }));
};

export const createDiscountRule = (rule) => {
  const { id, name, discount_type, discount_value, condition_type, threshold, max_discount_cap, priority, is_active } = rule;
  db.prepare(`
    INSERT INTO discount_rules (id, name, discount_type, discount_value, condition_type, threshold, max_discount_cap, priority, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, discount_type, discount_value, condition_type, threshold, max_discount_cap || null, priority || 0, is_active ? 1 : 0);
  return rule;
};

export const updateDiscountRule = (id, updates) => {
  const fields = [];
  const values = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.discount_type !== undefined) { fields.push('discount_type = ?'); values.push(updates.discount_type); }
  if (updates.discount_value !== undefined) { fields.push('discount_value = ?'); values.push(updates.discount_value); }
  if (updates.condition_type !== undefined) { fields.push('condition_type = ?'); values.push(updates.condition_type); }
  if (updates.threshold !== undefined) { fields.push('threshold = ?'); values.push(updates.threshold); }
  if (updates.max_discount_cap !== undefined) { fields.push('max_discount_cap = ?'); values.push(updates.max_discount_cap); }
  if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
  if (updates.is_active !== undefined) { fields.push('is_active = ?'); values.push(updates.is_active ? 1 : 0); }

  if (fields.length === 0) return null;

  values.push(id);
  db.prepare(`UPDATE discount_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return { id, ...updates };
};

export const deleteDiscountRule = (id) => {
  db.prepare('DELETE FROM discount_rules WHERE id = ?').run(id);
  return id;
};

export default db;
