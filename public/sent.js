// Is a draft sent from the app already in the synced history? Shared by the UI
// (hides its own "sent from app" copy) and the server (the AI's context).
// Email: the Message-ID the app sent it with; older sends (no id) and
// WhatsApp: a message of mine on the same channel within 15 minutes that
// starts with the same text.
const WINDOW = 15 * 60_000;
const id = (s) => String(s || '').trim().replace(/^<|>$/g, '').toLowerCase();
const key = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
// The same start: the first 60 characters, or all of the shorter one.
const sameStart = (a, b) => { const n = Math.min(60, a.length, b.length); return n > 0 && a.slice(0, n) === b.slice(0, n); };

export function inHistory(r, messages = []) {
  return messages.some((m) => m.fromMe && m.channel === r.channel && (
    (r.messageId && m.messageId && id(m.messageId) === id(r.messageId))
    || (Math.abs(new Date(m.at) - new Date(r.updatedAt)) <= WINDOW && sameStart(key(m.text), key(r.text)))));
}
