// The Messages list: every snapshot person with at least one message, newest
// conversation first, with a one-line preview and an unread count. Read state
// is { personId: ISO time } in reads.json in the app data folder; chats you
// marked unread are { personId: ISO time marked } in marks.json.
import { readData, writeData } from './cache.js';

let reads, marks;
export const getReads = () => (reads ??= readData('reads', {}));
export const getMarks = () => (marks ??= readData('marks', {}));

// Marks a chat read up to now (or its newest message, if that's later).
export function markRead(person, now = new Date().toISOString()) {
  const last = person.messages?.at(-1)?.at;
  getReads()[person.id] = last && last > now ? last : now;
  writeData('reads', reads);
  if (getMarks()[person.id]) { delete marks[person.id]; writeData('marks', marks); }
  return reads[person.id];
}

// Marked unread by hand: counts as unread and stays on top until read again.
export function markUnread(person, now = new Date().toISOString()) {
  getMarks()[person.id] = now;
  writeData('marks', marks);
  return now;
}

// Client messages after both the last time the chat was read and my last message.
export function unread(messages = [], readAt = null) {
  const mine = messages.findLast((m) => m.fromMe)?.at ?? '';
  const since = readAt && readAt > mine ? readAt : mine;
  return messages.filter((m) => !m.fromMe && m.at > since).length;
}

const PREVIEW = 140;
export const oneLine = (s = '') => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > PREVIEW ? t.slice(0, PREVIEW - 1) + '…' : t;
};

// Newest conversation first; chats marked unread on top (newest mark first).
// marked: unread only because of the mark (the UI shows a dot, not a count).
export function chatList(people, readMap = getReads(), markMap = getMarks()) {
  return people.filter((p) => p.messages?.length)
    .map((p) => {
      const m = p.messages.at(-1), n = unread(p.messages, readMap[p.id]), mark = markMap[p.id];
      return {
        id: p.id, name: p.name, stage: p.stage ?? null,
        channels: [...new Set(p.messages.map((x) => x.channel))].sort(),
        last: { channel: m.channel, at: m.at, fromMe: m.fromMe, text: oneLine(m.text || m.subject || '') },
        unread: n || (mark ? 1 : 0), ...(mark && { markedAt: mark }), ...(mark && !n && { marked: true }),
      };
    })
    .sort((a, b) => (b.markedAt ?? '').localeCompare(a.markedAt ?? '') || b.last.at.localeCompare(a.last.at));
}
