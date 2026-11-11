// WhatsApp history from the whatsapp-mcp bridge's local SQLite database.
// Read-only; the bridge keeps writing to it while it runs.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

const DB_PATH = process.env.WHATSAPP_DB ||
  new URL('../vendor/whatsapp-mcp/whatsapp-bridge/store/messages.db', import.meta.url).pathname;

export const whatsappConfigured = () => existsSync(DB_PATH);

let db;
function open() {
  if (!db) db = new DatabaseSync(DB_PATH, { readOnly: true });
  return db;
}

// "+63 917 123 4567" -> "639171234567" (WhatsApp JIDs are digits only, with country code).
export const whatsappJids = (phones) =>
  [...new Set(phones.map((p) => String(p).replace(/\D/g, '')).filter(Boolean))].map((d) => `${d}@s.whatsapp.net`);

export function whatsappHistory(phones, limit = Number(process.env.WHATSAPP_LIMIT || 500)) {
  if (!whatsappConfigured() || phones.length === 0) return [];
  const jids = whatsappJids(phones);
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
