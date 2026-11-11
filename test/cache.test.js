import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'outreach-cache-'));
process.env.OUTREACH_DATA_DIR = dir;
const cache = await import('../lib/cache.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('JSON values round-trip', () => {
  assert.equal(cache.getJSON('nope'), undefined);
  cache.setJSON('snapshot', { at: 'x', people: [{ id: '1' }] });
  assert.deepEqual(cache.getJSON('snapshot'), { at: 'x', people: [{ id: '1' }] });
});

test('email headers grow incrementally and reset when UIDVALIDITY changes', () => {
  assert.equal(cache.emailFolder('INBOX', 'v1'), 0);
  cache.addEmailHeaders('INBOX', [{ uid: 3, addresses: ['a@x'] }, { uid: 7, addresses: ['b@x'] }]);
  cache.cacheEmail('INBOX', 7, { subject: 'Hi' });
  assert.equal(cache.emailFolder('INBOX', 'v1'), 7); // next fetch starts after 7
  assert.deepEqual(cache.emailHeaders('INBOX').map((h) => h.uid), [3, 7]);
  assert.deepEqual(cache.cachedEmail('INBOX', 7), { subject: 'Hi' });

  assert.equal(cache.emailFolder('INBOX', 'v2'), 0); // server renumbered: start over
  assert.deepEqual(cache.emailHeaders('INBOX'), []);
  assert.equal(cache.cachedEmail('INBOX', 7), undefined);
});

test('WhatsApp complete chats are remembered', () => {
  assert.equal(cache.waComplete('1@lid'), false);
  cache.markWaComplete('1@lid');
  cache.markWaComplete('1@lid');
  assert.equal(cache.waComplete('1@lid'), true);
});
