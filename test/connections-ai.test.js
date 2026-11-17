import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.OUTREACH_DATA_DIR = mkdtempSync(join(tmpdir(), 'outreach-'));
const { connectionsForAI, renderConnections } = await import('../lib/connections.js');
const { logConnection, connectionLog } = await import('../lib/connlog.js');

const LIST = [
  { id: 'crm', name: 'CRM', what: 'contacts', ai: { where: '"# Client"' } },
  { id: 'cal', name: 'Calendar', what: 'free time', ai: { section: async (p) => `free for ${p.name}` } },
  { id: 'off', name: 'Off', what: 'nothing', ai: { section: async () => '' } },
  { id: 'bad', name: 'Bad', what: 'broken', ai: { section: async () => { throw new Error('timeout'); } } },
  { id: 'none', name: 'No AI', what: 'ui only' },
];

test('every connection with AI data is listed, its section included, a failure said plainly', async () => {
  const list = await connectionsForAI({ name: 'Jana' }, LIST);
  assert.deepEqual(list.map((c) => c.id), ['crm', 'cal', 'off', 'bad']);
  const s = renderConnections(list);
  assert.match(s, /^# Your connections\n/);
  assert.match(s, /Never say you have no access/);
  assert.match(s, /- CRM \(contacts\): in "# Client"/);
  assert.match(s, /- Off \(nothing\): not set up/);
  assert.match(s, /# Calendar\nfree for Jana/);
  assert.match(s, /# Bad\nBad couldn't be read right now \(timeout\)\./);
  assert.equal(renderConnections([]), '');
});

test('the log keeps the newest entries per connection and direction', () => {
  for (let i = 0; i < 12; i++) logConnection('cal', 'toAI', { person: 'A', purpose: 'draft', text: `t${i}` });
  logConnection('cal', 'out', { person: 'A', purpose: 'send', text: 'hi' });
  const l = connectionLog('cal');
  assert.equal(l.toAI.length, 10);
  assert.equal(l.toAI[0].text, 't11');
  assert.equal(l.out[0].text, 'hi');
  assert.deepEqual(connectionLog('nope'), { toAI: [], out: [] });
});
