// WhatsApp history from the whatsapp-mcp bridge's local SQLite database.
// Read-only; the bridge keeps writing to it while it runs.
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { waComplete, markWaComplete, waAskedAt, markWaAsked } from './cache.js';

const DB_PATH = process.env.WHATSAPP_DB ||
  new URL('../vendor/whatsapp-mcp/whatsapp-bridge/store/messages.db', import.meta.url).pathname;

export const whatsappConfigured = () => existsSync(DB_PATH);

// The bridge's own whatsmeow store, next to messages.db. Read only for its
// lid -> phone map: WhatsApp now files most 1:1 chats under a hidden
// "<lid>@lid" id instead of "<phone>@s.whatsapp.net".
const DEVICE_DB_PATH = join(dirname(DB_PATH), 'whatsapp.db');

// The bridge writes while we read: a short busy timeout, and on any error the
// handle is dropped and reopened on the next call (bridge restarted, DB replaced).
let db, deviceDb;
const ro = (path) => new DatabaseSync(path, { readOnly: true, timeout: 100 });
function open() {
  if (!db) db = ro(DB_PATH);
  return db;
}
function reset() {
  try { db?.close(); deviceDb?.close(); } catch {}
  db = deviceDb = undefined;
}

function lidsFor(digits) {
  if (!existsSync(DEVICE_DB_PATH)) return [];
  deviceDb ??= ro(DEVICE_DB_PATH);
  return deviceDb.prepare('SELECT lid FROM whatsmeow_lid_map WHERE pn = ?').all(digits).map((r) => String(r.lid));
}

// The whole lid map at once (phone digits -> lids), for many people in one go.
function lidMap() {
  const map = new Map();
  if (!existsSync(DEVICE_DB_PATH)) return map;
  deviceDb ??= ro(DEVICE_DB_PATH);
  for (const r of deviceDb.prepare('SELECT lid, pn FROM whatsmeow_lid_map').all()) {
    const pn = String(r.pn);
    map.set(pn, [...(map.get(pn) ?? []), String(r.lid)]);
  }
  return map;
}

// Is this number on WhatsApp, as far as the bridge knows? WhatsApp hands the
// bridge a hidden id (lid) for every account it has seen, so a number with no
// lid and no chat most likely has no WhatsApp. Not configured = assume yes.
export function whatsappKnown(phone) {
  const d = String(phone).replace(/\D/g, '');
  if (!d || !whatsappConfigured()) return Boolean(d);
  return lidsFor(d).length > 0 ||
    open().prepare('SELECT 1 FROM chats WHERE jid = ?').get(`${d}@s.whatsapp.net`) !== undefined;
}

// "+63 917 123 4567" -> "639171234567" (WhatsApp JIDs are digits only, with country code).
// A phone's chat ids: "<digits>@s.whatsapp.net" plus any "<lid>@lid" mapped to it.
export const whatsappJids = (phones, lids = () => []) =>
  [...new Set(phones.map((p) => String(p).replace(/\D/g, '')).filter(Boolean))]
    .flatMap((d) => [`${d}@s.whatsapp.net`, ...lids(d).map((l) => `${l}@lid`)]);

// chat jid -> ids of the people it belongs to (a shared number can be several).
export function jidIndex(people, lids = () => []) {
  const out = new Map();
  for (const p of people) {
    for (const jid of whatsappJids(p.phones || [], lids)) out.set(jid, [...(out.get(jid) ?? []), p.id]);
  }
  return out;
}

// Ids of the people these chats belong to (the lid map is re-read, so a chat
// filed under a newly learned lid still finds its person).
export function whatsappOwners(jids, people) {
  try {
    const map = lidMap(), index = jidIndex(people, (d) => map.get(d) ?? []);
    return [...new Set(jids.flatMap((j) => index.get(j) ?? []))];
  } catch (e) { reset(); throw e; }
}

const toMessage = (r) => ({
  channel: 'whatsapp',
  id: `${r.chat_jid}:${r.id}`,
  // The bridge stores times like "2025-03-01 10:00:00+08:00".
  at: new Date(String(r.timestamp).replace(' ', 'T')).toISOString(),
  fromMe: Boolean(r.is_from_me),
  text: r.content || (r.media_type ? `[${r.media_type}]` : ''),
});

// Same session shape as email, so sync.js treats every channel alike. All the
// given people's chats are read in one query; history(person) is the newest
// `limit` messages of that person's chats.
export function whatsappSession(people = [], limit = Number(process.env.WHATSAPP_LIMIT || 500)) {
  if (!whatsappConfigured()) return { history: () => [], close: () => {} };
  try {
    const map = lidMap(), lids = (d) => map.get(d) ?? [];
    const index = jidIndex(people, lids), byJid = new Map();
    const rows = index.size ? open().prepare(`
      SELECT id, chat_jid, content, timestamp, is_from_me, media_type FROM messages
      WHERE chat_jid IN (SELECT value FROM json_each(?))`).all(JSON.stringify([...index.keys()])) : [];
    for (const r of rows) byJid.set(r.chat_jid, [...(byJid.get(r.chat_jid) ?? []), toMessage(r)]);
    return {
      history: (person) => whatsappJids(person.phones || [], lids).flatMap((j) => byJid.get(j) ?? [])
        .sort((a, b) => a.at.localeCompare(b.at)).slice(-limit),
      close: () => {},
    };
  } catch (e) { reset(); throw e; }
}

// Calls onChats(jids) with the chats that got new or changed rows, checking
// about once a second. Cheap: MAX(rowid) per tick, a row scan only on change
// (the bridge's INSERT OR REPLACE gives every new or edited message a new rowid).
// Survives the bridge not running, restarting or replacing the DB.
export function whatsappWatch(onChats, every = 1000) {
  let last = null;
  const tick = () => {
    if (!whatsappConfigured()) return;
    try {
      const d = open(), max = d.prepare('SELECT MAX(rowid) m FROM messages').get().m ?? 0;
      if (last === null || max < last) { last = max; return; }
      if (max === last) return;
      const jids = d.prepare('SELECT DISTINCT chat_jid FROM messages WHERE rowid > ?').all(last).map((r) => r.chat_jid);
      last = max;
      onChats(jids);
    } catch { reset(); }
  };
  tick();
  const t = setInterval(tick, every);
  t.unref?.();
  return () => clearInterval(t);
}

// Older history for chosen chats only. The phone sends just recent history at
// link time; the bridge's /api/history asks it for up to 50 messages before the
// oldest one stored in a chat (the bridge stores them, we only read).
const BRIDGE_URL = process.env.WHATSAPP_BRIDGE_URL || 'http://localhost:8080';
const PAGE = 50, HOUR = 36e5;

// A chat is asked again only when not known complete and not asked within
// `hours` (a timeout or a trickle waits until then instead of every refresh).
export const backfillDue = ({ complete, askedAt }, now = Date.now(), hours = 12) =>
  !complete && (!askedAt || now - Date.parse(askedAt) >= hours * HOUR);

// Pages back through these people's due chats, at most `maxPages` per chat
// per run. Only messages older than the chat's oldest count as gained, so live
// messages arriving meanwhile don't keep a chat "growing". A page that brings
// less than half of what was asked means the phone has nothing older: the chat
// is complete. Returns the jids that gained older messages.
export async function whatsappBackfill(people, onProgress = () => {},
  { maxPages = 5, hours = Number(process.env.WHATSAPP_BACKFILL_HOURS || 12) } = {}) {
  if (!whatsappConfigured()) return new Set();
  const map = lidMap(), d = open();
  const stored = d.prepare('SELECT COUNT(*) n, MIN(timestamp) oldest FROM messages WHERE chat_jid = ?');
  const older = d.prepare('SELECT COUNT(*) n FROM messages WHERE chat_jid = ? AND timestamp < ?');
  const chats = [...jidIndex(people, (x) => map.get(x) ?? []).keys()]
    .filter((jid) => backfillDue({ complete: waComplete(jid), askedAt: waAskedAt(jid) }, Date.now(), hours) && stored.get(jid).n > 0);
  const gained = new Set();
  for (const [i, jid] of chats.entries()) {
    onProgress(i, chats.length);
    markWaAsked(jid);
    for (let page = 0; page < maxPages; page++) {
      const { oldest } = stored.get(jid);
      const res = await fetch(`${BRIDGE_URL}/api/history`, {
        method: 'POST', body: JSON.stringify({ chat_jid: jid, count: PAGE }), signal: AbortSignal.timeout(30_000),
      }).catch(() => { throw new Error('bridge not running, so no older history'); });
      if (!res.ok) throw new Error(`bridge: ${(await res.text()).trim()}`);
      const { timeout } = await res.json();
      if (timeout) break; // phone didn't answer; asked again after `hours`
      const n = older.get(jid, oldest).n;
      if (n > 0) gained.add(jid);
      if (n < PAGE / 2) { markWaComplete(jid); break; } // remembered across restarts
    }
  }
  onProgress(chats.length, chats.length);
  return gained;
}

// Opens the WhatsApp app on this chat with the text filled in; the user sends it there.
export const whatsappLink = (phone, text) =>
  `whatsapp://send?phone=${String(phone).replace(/\D/g, '')}&text=${encodeURIComponent(text)}`;
export const openWhatsApp = (phone, text) => promisify(execFile)('open', [whatsappLink(phone, text)]);
