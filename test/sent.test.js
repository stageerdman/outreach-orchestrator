import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inHistory } from '../public/sent.js';

const sent = { channel: 'email', updatedAt: '2026-11-13T14:00:05Z', text: 'Dobrý den Honzo,\ntady Vlado', messageId: '<abc@x.cz>' };

test('an email sent from the app matches its Sent-folder copy by Message-ID, even when the copy is dated earlier', () => {
  assert.equal(inHistory(sent, [{ channel: 'email', fromMe: true, at: '2026-11-13T14:00:01Z', messageId: 'ABC@x.cz', text: 'other' }]), true);
});

test('without an id: same channel, mine, within 15 minutes, same start of text', () => {
  const { messageId, ...old } = sent;
  assert.equal(inHistory(old, [{ channel: 'email', fromMe: true, at: '2026-11-13T13:59:58Z', text: 'Dobrý  den Honzo, tady Vlado\n\nVlado' }]), true);
  assert.equal(inHistory(old, [{ channel: 'email', fromMe: true, at: '2026-11-13T15:00:00Z', text: 'Dobrý den Honzo, tady Vlado' }]), false);
  assert.equal(inHistory(old, [{ channel: 'whatsapp', fromMe: true, at: '2026-11-13T14:00:00Z', text: 'Dobrý den Honzo, tady Vlado' }]), false);
  assert.equal(inHistory(old, [{ channel: 'email', fromMe: false, at: '2026-11-13T14:00:00Z', text: 'Dobrý den Honzo, tady Vlado' }]), false);
});
