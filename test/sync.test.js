import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect } from '../lib/sync.js';

const msg = (channel, at) => ({ channel, id: `${channel}:${at}`, at, fromMe: false, text: '' });
const people = [
  { id: '1', name: 'Ana', emails: ['a@x'], phones: [] },
  { id: '2', name: 'Bo', emails: [], phones: ['+1'] },
  { id: '3', name: 'Cy', emails: [], phones: [] },
];
const fake = (byId) => async () => ({ history: async (p) => byId[p.id] ?? [], close: async () => {} });

test('merges channels per person, sorted by time, with counts and lastAt', async () => {
  const { people: out } = await collect(people, {
    email: fake({ 1: [msg('email', '2026-01-03T00:00:00Z')] }),
    whatsapp: fake({ 1: [msg('whatsapp', '2026-01-01T00:00:00Z')], 2: [msg('whatsapp', '2026-02-01T00:00:00Z')] }),
  });
  assert.deepEqual(out.map((p) => p.id), ['2', '1', '3']); // latest contact first, never-contacted last
  const ana = out[1];
  assert.deepEqual(ana.messages.map((m) => m.channel), ['whatsapp', 'email']);
  assert.deepEqual(ana.counts, { email: 1, whatsapp: 1 });
  assert.equal(ana.lastAt, '2026-01-03T00:00:00Z');
  assert.equal(out[2].lastAt, null);
});

test('a source that fails to open is reported and the others still run', async () => {
  const { people: out, errors } = await collect(people, {
    email: async () => { throw new Error('auth failed'); },
    whatsapp: fake({ 2: [msg('whatsapp', '2026-02-01T00:00:00Z')] }),
  });
  assert.deepEqual(errors, { email: 'auth failed' });
  assert.equal(out[0].counts.whatsapp, 1);
  assert.equal(out[0].counts.email, 0);
});

test('a per-person failure is kept on that person, and progress is reported', async () => {
  const seen = [];
  let closed = false;
  const { people: out } = await collect(people, {
    email: async () => ({
      history: async (p) => { if (p.id === '1') throw new Error('timeout'); return []; },
      close: async () => { closed = true; },
    }),
  }, (n) => seen.push(n));
  assert.deepEqual(out.find((p) => p.id === '1').errors, { email: 'timeout' });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.ok(closed);
});
