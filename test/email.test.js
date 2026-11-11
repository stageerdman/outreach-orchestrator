import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../lib/email.js';

const at = '2026-01-01T10:00:00.000Z';

test('same Message-ID in Inbox and Sent is kept once', () => {
  const out = dedupe([
    { id: 'INBOX:1', messageId: '<a@x>', at, subject: 'Hi' },
    { id: 'Sent:9', messageId: '<a@x>', at, subject: 'Hi' },
  ]);
  assert.deepEqual(out.map((m) => m.id), ['INBOX:1']);
});

test('different emails with the same date and subject are both kept', () => {
  const out = dedupe([
    { id: 'INBOX:1', messageId: '<a@x>', at, subject: 'Hi' },
    { id: 'INBOX:2', messageId: '<b@x>', at, subject: 'Hi' },
  ]);
  assert.equal(out.length, 2);
});

test('without Message-ID, date + subject is the fallback key', () => {
  const out = dedupe([
    { id: 'INBOX:1', messageId: '', at, subject: 'Hi' },
    { id: 'Sent:9', messageId: '', at, subject: 'Hi' },
  ]);
  assert.equal(out.length, 1);
});

test('matching picks emails from/to/cc the person, newest `limit` per folder', async () => {
  const { matching } = await import('../lib/email.js');
  const index = [
    { folder: 'INBOX', uid: 3, addresses: ['me@x', 'ana@x'] },
    { folder: 'INBOX', uid: 1, addresses: ['ana@x'] },
    { folder: 'INBOX', uid: 2, addresses: ['bo@x'] },
    { folder: 'INBOX', uid: 5, addresses: ['me@x', 'ana@x'] },
    { folder: 'Sent', uid: 9, addresses: ['me@x', 'ana@x'] },
  ];
  assert.deepEqual(matching(index, ['ana@x'], 2), { INBOX: [3, 5], Sent: [9] });
  assert.deepEqual(matching(index, ['nobody@x'], 2), {});
  assert.deepEqual(matching(index, [], 2), {});
});
