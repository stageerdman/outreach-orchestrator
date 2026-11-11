// WhatsApp history from the whatsapp-mcp bridge's local SQLite database.
// Read-only; the bridge keeps writing to it while it runs.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DB_PATH = process.env.WHATSAPP_DB ||
  new URL('../vendor/whatsapp-mcp/whatsapp-bridge/store/messages.db', import.meta.url).pathname;

export const whatsappConfigured = () => existsSync(DB_PATH);

// The bridge's own whatsmeow store, next to messages.db. Read only for its
// lid -> phone map: WhatsApp now files most 1:1 chats under a hidden
// "<lid>@lid" id instead of "<phone>@s.whatsapp.net".
const DEVICE_DB_PATH = join(dirname(DB_PATH), 'whatsapp.db');

let db, deviceDb;
function open() {
  if (!db) db = new DatabaseSync(DB_PATH, { readOnly: true });
  return db;
}

function lidsFor(digits) {
  if (!existsSync(DEVICE_DB_PATH)) return [];
  deviceDb ??= new DatabaseSync(DEVICE_DB_PATH, { readOnly: true });
  return deviceDb.prepare('SELECT lid FROM whatsmeow_lid_map WHERE pn = ?').all(digits).map((r) => String(r.lid));
}

// "+63 917 123 4567" -> "639171234567" (WhatsApp JIDs are digits only, with country code).
// A phone's chat ids: "<digits>@s.whatsapp.net" plus any "<lid>@lid" mapped to it.
export const whatsappJids = (phones, lids = () => []) =>
  [...new Set(phones.map((p) => String(p).replace(/\D/g, '')).filter(Boolean))]
    .flatMap((d) => [`${d}@s.whatsapp.net`, ...lids(d).map((l) => `${l}@lid`)]);

export function whatsappHistory(phones, limit = Number(process.env.WHATSAPP_LIMIT || 500)) {
  if (!whatsappConfigured() || phones.length === 0) return [];
  const jids = whatsappJids(phones, lidsFor);
  if (jids.length === 0) return [];

  const rows = open().prepare(`
    SELECT id, chat_jid, sender, content, timestamp, is_from_me, media_type
    FROM messages
    WHERE chat_jid IN (${jids.map(() => '?').join(',')})
    ORDER BY timestamp DESC
    LIMIT ?`).all(...jids, limit);

  return rows.map((r) => ({
    channel: 'whatsapp',
    id: `${r.chat_jid}:${r.id}`,
    // The bridge stores times like "2025-03-01 10:00:00+08:00".
    at: new Date(String(r.timestamp).replace(' ', 'T')).toISOString(),
    fromMe: Boolean(r.is_from_me),
    text: r.content || (r.media_type ? `[${r.media_type}]` : ''),
  }));
}

// Same session shape as email, so sync.js treats every channel alike.
export const whatsappSession = () => ({
  history: (person) => whatsappHistory(person.phones),
  close: () => {},
});

// Older history for chosen chats only. The phone sends just recent history at
// link time; the bridge's /api/history asks it for up to 50 messages before the
// oldest one stored in a chat (the bridge stores them, we only read).
const BRIDGE_URL = process.env.WHATSAPP_BRIDGE_URL || 'http://localhost:8080';
const complete = new Set(); // chats with nothing older on the phone, this server run

// Pages back through these people's chats until the phone has nothing older.
// Returns how many messages were added.
export async function whatsappBackfill(people, onProgress = () => {}, maxPages = 20) {
  if (!whatsappConfigured()) return 0;
  const stored = open().prepare('SELECT COUNT(*) n FROM messages WHERE chat_jid = ?');
  const chats = [...new Set(people.flatMap((p) => whatsappJids(p.phones, lidsFor)))]
    .filter((jid) => !complete.has(jid) && stored.get(jid).n > 0);
  let added = 0;
  for (const [i, jid] of chats.entries()) {
    onProgress(i, chats.length);
    for (let page = 0; page < maxPages; page++) {
      const before = stored.get(jid).n;
      const res = await fetch(`${BRIDGE_URL}/api/history`, {
        method: 'POST', body: JSON.stringify({ chat_jid: jid, count: 50 }),
      }).catch(() => { throw new Error('bridge not running, so no older history'); });
      if (!res.ok) throw new Error(`bridge: ${(await res.text()).trim()}`);
      const { timeout } = await res.json();
      const gained = stored.get(jid).n - before;
      added += gained;
      if (timeout) break; // phone didn't answer; try again next refresh
      if (gained <= 0) { complete.add(jid); break; }
    }
  }
  onProgress(chats.length, chats.length);
  return added;
}
