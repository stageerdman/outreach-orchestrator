import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'outreach-chats-'));
process.env.OUTREACH_DATA_DIR = dir;
const { unread, chatList, oneLine, markRead, markUnread, getReads, getMarks } = await import('../lib/chats.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const msg = (at, fromMe, text = 'hi', channel = 'whatsapp') => ({ channel, id: at, at, fromMe, text });

test('unread counts client messages after my last message', () => {
  const ms = [msg('2026-01-01', false), msg('2026-01-02', true), msg('2026-01-03', false), msg('2026-01-04', false)];
  assert.equal(unread(ms), 2);
  assert.equal(unread([msg('2026-01-01', false), msg('2026-01-02', false)]), 2); // I never wrote
  assert.equal(unread([msg('2026-01-01', false), msg('2026-01-02', true)]), 0);
  assert.equal(unread([]), 0);
});

test('unread counts only after the later of last read and my last message', () => {
  const ms = [msg('2026-01-02', true), msg('2026-01-03', false), msg('2026-01-05', false)];
  assert.equal(unread(ms, '2026-01-04'), 1); // read after the first reply
  assert.equal(unread(ms, '2026-01-01'), 2); // read before my message: mine counts
});

test('the chat list: people with messages, newest first, one-line preview', () => {
  const people = [
    { id: '1', name: 'Ana', stage: { key: 'new', label: 'New lead' }, messages: [msg('2026-01-01', false, 'old', 'email')] },
    { id: '2', name: 'Bo', stage: null, messages: [msg('2026-01-02', true, 'x', 'email'), msg('2026-01-03', false, '  Hello\n\n  there  ')] },
    { id: '3', name: 'Cy', messages: [] },
  ];
  assert.deepEqual(chatList(people, { 1: '2026-02-01' }), [
    { id: '2', name: 'Bo', stage: null, channels: ['email', 'whatsapp'], unread: 1,
      last: { channel: 'whatsapp', at: '2026-01-03', fromMe: false, text: 'Hello there' } },
    { id: '1', name: 'Ana', stage: { key: 'new', label: 'New lead' }, channels: ['email'], unread: 0,
      last: { channel: 'email', at: '2026-01-01', fromMe: false, text: 'old' } },
  ]);
});

test('previews are clipped; an email without text falls back to its subject', () => {
  assert.equal(oneLine('a'.repeat(300)).length, 140);
  const [c] = chatList([{ id: '1', name: 'A', messages: [{ ...msg('2026-01-01', false, ''), subject: 'Offer' }] }], {});
  assert.equal(c.last.text, 'Offer');
});

test('marking read stores the time (or the newest message, if later) and is persisted', () => {
  const at = markRead({ id: '7', messages: [msg('2026-01-01T00:00:00.000Z', false)] }, '2026-03-01T00:00:00.000Z');
  assert.equal(at, '2026-03-01T00:00:00.000Z');
  assert.equal(markRead({ id: '8', messages: [msg('2027-01-01T00:00:00.000Z', false)] }, '2026-03-01T00:00:00.000Z'), '2027-01-01T00:00:00.000Z');
  assert.equal(getReads()['7'], at);
});

test('a chat marked unread counts as unread, goes on top, and is cleared by reading it', () => {
  const people = [
    { id: 'a', name: 'A', messages: [msg('2026-01-05', false)] },
    { id: 'b', name: 'B', messages: [msg('2026-01-01', false), msg('2026-01-02', true)] },
  ];
  const [top, next] = chatList(people, { a: '2026-02-01' }, { b: '2026-03-01' });
  assert.deepEqual([top.id, top.unread, top.marked, next.id, next.unread, next.marked], ['b', 1, true, 'a', 0, undefined]);
  // A real unread count wins over the mark (no dot, the number shows).
  assert.equal(chatList([{ id: 'c', name: 'C', messages: [msg('2026-01-01', false), msg('2026-01-02', false)] }], {}, { c: '2026-03-01' })[0].marked, undefined);
  const p = { id: '9', messages: [msg('2026-01-01T00:00:00.000Z', false)] };
  markUnread(p, '2026-03-01T00:00:00.000Z');
  assert.equal(getMarks()['9'], '2026-03-01T00:00:00.000Z');
  markRead(p);
  assert.equal(getMarks()['9'], undefined);
});
