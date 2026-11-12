import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatsappJids } from '../lib/whatsapp.js';

test('phones become digit-only WhatsApp JIDs', () => {
  assert.deepEqual(whatsappJids(['+63 917 123-4567', '(1) 555 0100']),
    ['639171234567@s.whatsapp.net', '15550100@s.whatsapp.net']);
});

test('empty and duplicate phones are dropped', () => {
  assert.deepEqual(whatsappJids(['', 'n/a', '+63 917', '63917']), ['63917@s.whatsapp.net']);
});

test('hidden-id (lid) chats mapped to the phone are included', () => {
  const lids = (d) => (d === '639171234567' ? ['111222333444555'] : []);
  assert.deepEqual(whatsappJids(['+63 917 123 4567', '+1 555'], lids), [
    '639171234567@s.whatsapp.net', '111222333444555@lid', '1555@s.whatsapp.net',
  ]);
});

test('the WhatsApp link opens the chat by phone digits with the text encoded', async () => {
  const { whatsappLink } = await import('../lib/whatsapp.js');
  assert.equal(whatsappLink('+420 775 623 723', 'Dobrý den, jak?'),
    'whatsapp://send?phone=420775623723&text=Dobr%C3%BD%20den%2C%20jak%3F');
});

test('chat jids map back to their people, a shared number to each of them', async () => {
  const { jidIndex } = await import('../lib/whatsapp.js');
  const lids = (d) => (d === '420111' ? ['999'] : []);
  const index = jidIndex([
    { id: 'a', phones: ['+420 111'] }, { id: 'b', phones: ['420111', '+1 2'] }, { id: 'c', phones: [] },
  ], lids);
  assert.deepEqual(Object.fromEntries(index), {
    '420111@s.whatsapp.net': ['a', 'b'], '999@lid': ['a', 'b'], '12@s.whatsapp.net': ['b'],
  });
});

test('backfill asks a chat again only when incomplete and not asked within the hours', async () => {
  const { backfillDue } = await import('../lib/whatsapp.js');
  const now = Date.parse('2026-11-12T12:00:00Z');
  assert.equal(backfillDue({ complete: false, askedAt: null }, now), true);
  assert.equal(backfillDue({ complete: true, askedAt: null }, now), false);
  assert.equal(backfillDue({ complete: false, askedAt: '2026-11-12T01:00:00Z' }, now), false); // 11 h ago
  assert.equal(backfillDue({ complete: false, askedAt: '2026-11-11T23:00:00Z' }, now), true); // 13 h ago
  assert.equal(backfillDue({ complete: false, askedAt: '2026-11-12T11:00:00Z' }, now, 0.5), true);
});
