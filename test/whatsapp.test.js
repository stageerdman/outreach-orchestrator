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
