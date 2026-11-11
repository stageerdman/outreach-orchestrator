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
