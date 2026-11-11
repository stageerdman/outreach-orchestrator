// Local cache: the last snapshot, email headers and bodies, and which WhatsApp
// chats are fully fetched. Lives outside the repo (private data), opened on
// first use. OUTREACH_DATA_DIR overrides the location (tests use a temp dir).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function dataDir() {
  const dir = process.env.OUTREACH_DATA_DIR || join(homedir(), 'Library/Application Support/Outreach');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

let db;
function open() {
  if (db) return db;
  db = new DatabaseSync(join(dataDir(), 'cache.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS email_folders (folder TEXT PRIMARY KEY, validity TEXT);
    CREATE TABLE IF NOT EXISTS email_headers (folder TEXT, uid INTEGER, addresses TEXT, PRIMARY KEY (folder, uid));
    CREATE TABLE IF NOT EXISTS emails (folder TEXT, uid INTEGER, msg TEXT, PRIMARY KEY (folder, uid));
    CREATE TABLE IF NOT EXISTS wa_complete (jid TEXT PRIMARY KEY);
  `);
  return db;
}

export function getJSON(key) {
  const row = open().prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : undefined;
}
export function setJSON(key, value) {
  open().prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

// Email: a folder's cache is valid only for one UIDVALIDITY; a change wipes it.
// Returns the highest cached UID (0 when empty or reset).
export function emailFolder(folder, validity) {
  const d = open();
  const known = d.prepare('SELECT validity FROM email_folders WHERE folder = ?').get(folder);
  if (known?.validity !== validity) {
    d.prepare('DELETE FROM email_headers WHERE folder = ?').run(folder);
    d.prepare('DELETE FROM emails WHERE folder = ?').run(folder);
    d.prepare('INSERT OR REPLACE INTO email_folders (folder, validity) VALUES (?, ?)').run(folder, validity);
  }
  return d.prepare('SELECT MAX(uid) m FROM email_headers WHERE folder = ?').get(folder).m ?? 0;
}
export function addEmailHeaders(folder, headers) {
  const ins = open().prepare('INSERT OR REPLACE INTO email_headers (folder, uid, addresses) VALUES (?, ?, ?)');
  for (const h of headers) ins.run(folder, h.uid, JSON.stringify(h.addresses));
}
export function emailHeaders(folder) {
  return open().prepare('SELECT uid, addresses FROM email_headers WHERE folder = ? ORDER BY uid').all(folder)
    .map((r) => ({ folder, uid: r.uid, addresses: JSON.parse(r.addresses) }));
}
export function cachedEmail(folder, uid) {
  const row = open().prepare('SELECT msg FROM emails WHERE folder = ? AND uid = ?').get(folder, uid);
  return row ? JSON.parse(row.msg) : undefined;
}
export function cacheEmail(folder, uid, msg) {
  open().prepare('INSERT OR REPLACE INTO emails (folder, uid, msg) VALUES (?, ?, ?)').run(folder, uid, JSON.stringify(msg));
}

// WhatsApp chats whose full history the phone has already sent.
export const waComplete = (jid) => Boolean(open().prepare('SELECT 1 FROM wa_complete WHERE jid = ?').get(jid));
export const markWaComplete = (jid) => open().prepare('INSERT OR IGNORE INTO wa_complete (jid) VALUES (?)').run(jid);
