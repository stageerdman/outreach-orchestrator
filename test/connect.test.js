import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'outreach-connect-'));
process.env.OUTREACH_DATA_DIR = dir;
// A fake `claude` that logs its args and streams the lines in turn.jsonl (or sleeps when told).
const calls = join(dir, 'calls'), turn = join(dir, 'turn.jsonl');
process.env.CLAUDE_BIN = join(dir, 'claude');
writeFileSync(process.env.CLAUDE_BIN, `#!/bin/sh\n{ printf '%s\\n' "$@"; echo ---; cat; echo ===; } >> ${calls}\nif [ -f ${dir}/slow ]; then exec sleep 30; fi\ncat ${turn}\n`, { mode: 0o755 });
const lines = (...e) => writeFileSync(turn, e.map((x) => JSON.stringify(x)).join('\n') + '\n');
const c = await import('../lib/connect.js');
const { listConnections } = await import('../lib/connections.js');
const { events } = await import('../lib/events.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));
const argsOf = () => readFileSync(calls, 'utf8').split('===\n').filter(Boolean).map((x) => x.split('\n---\n'));

test('a conversation: the first turn starts a session, later turns resume it; text and steps become the transcript', async () => {
  lines(
    { type: 'system', subtype: 'init', session_id: 'x' },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', name: 'Read', input: { file_path: `${c.REPO}/lib/email.js` } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: {} }, { type: 'text', text: 'Which calendar — Google, iCloud or Outlook?' }] } },
    { type: 'result', is_error: false, result: 'ok' },
  );
  let emitted = 0; events.on('connect', () => emitted++);
  await c.say('I want the AI to see my calendar');
  const s = c.getConversation();
  assert.equal(s.running, false);
  assert.deepEqual(s.items.map((i) => [i.kind, i.text]), [['user', 'I want the AI to see my calendar'], ['tool', 'Reading email.js'], ['ai', 'Which calendar — Google, iCloud or Outlook?']]);
  assert.equal(s.items[1].detail, 'lib/email.js');
  assert.ok(emitted >= 3);
  await c.say('Google');
  const [[a1, in1], [a2, in2]] = argsOf();
  assert.match(a1, /--dangerously-skip-permissions/);
  assert.match(a1, new RegExp(`--session-id\\n${s.sessionId}`));
  assert.match(a2, new RegExp(`--resume\\n${s.sessionId}`));
  assert.deepEqual([in1.trim(), in2.trim()], ['I want the AI to see my calendar', 'Google']);
});

test('one turn at a time; Stop ends it with a note; an error result is shown; reset starts over', async () => {
  writeFileSync(join(dir, 'slow'), '');
  const p = c.say('build it');
  assert.equal(c.getConversation().running, true);
  assert.throws(() => c.say('and this'), /Still working/);
  assert.throws(() => c.reset(), /Stop it first/);
  assert.equal(c.stop(), true);
  await p;
  rmSync(join(dir, 'slow'));
  assert.deepEqual(c.getConversation().items.at(-1).text, 'Stopped.');
  lines({ type: 'result', is_error: true, result: 'Not logged in' });
  await c.say('again');
  assert.deepEqual(c.getConversation().items.at(-1), { ...c.getConversation().items.at(-1), kind: 'error', text: 'Not logged in' });
  const r = c.reset();
  assert.deepEqual([r.items, r.sessionId], [[], null]);
});

test('steps in plain words, the raw command kept as detail', () => {
  assert.deepEqual(c.toolLine('Bash', { command: 'npm test' }).text, 'Running tests');
  assert.deepEqual(c.toolLine('Bash', { command: 'git commit -m x && git push' }).text, 'Saving the change');
  assert.deepEqual(c.toolLine('Bash', { command: 'npm install --save googleapis' }).text, 'Installing googleapis');
  assert.deepEqual(c.toolLine('Bash', { command: 'ls', description: 'List files' }).text, 'List files');
  assert.deepEqual(c.toolLine('Write', { file_path: `${c.REPO}/lib/calendar.js` }), { text: 'Changing calendar.js', detail: 'lib/calendar.js' });
  assert.equal(c.toolLine('TodoWrite', {}), null);
});

test('a secret goes into .env (replaced in place, quoted when needed), never into the chat', async () => {
  assert.equal(c.envWith('A=1\nexport KEY=old\n', 'KEY', 'new'), 'A=1\nKEY=new\n');
  assert.equal(c.envWith('', 'KEY', 'a b'), "KEY='a b'\n");
  assert.throws(() => c.envWith('', 'bad name', 'x'), /valid/);
  assert.throws(() => c.envWith('', 'KEY', 'a\nb'), /one line/);
  const env = join(dir, '.env');
  writeFileSync(env, 'IMAP_HOST=x\n');
  lines({ type: 'result', is_error: false, result: 'ok' });
  c.saveSecret('CAL_KEY', ' s3cret ', env);
  assert.equal(readFileSync(env, 'utf8'), 'IMAP_HOST=x\nCAL_KEY=s3cret\n');
  assert.equal(process.env.CAL_KEY, 's3cret');
  while (c.getConversation().running) await new Promise((r) => setTimeout(r, 20));
  const said = c.getConversation().items.filter((i) => i.kind === 'user').map((i) => i.text);
  assert.deepEqual(said, ['[CAL_KEY saved to .env]']);
  assert.ok(!JSON.stringify(c.getConversation()).includes('s3cret'));
});

test('connections: one plain object each; a status that throws shows as an error', () => {
  const list = listConnections({ people: [], errors: {} }, [
    { id: 'a', name: 'A', what: 'w', status: () => ({ state: 'live', detail: '2 things' }) },
    { id: 'b', name: 'B', what: 'w', flow: 'both', status: () => { throw new Error('boom'); } },
    { id: 'c', name: 'C', what: 'w', flow: 'both', status: () => ({ state: 'live', detail: 'Sending only', flow: 'out' }) },
  ]);
  assert.deepEqual(list, [{ id: 'a', name: 'A', what: 'w', flow: 'in', state: 'live', detail: '2 things' }, { id: 'b', name: 'B', what: 'w', flow: 'both', state: 'error', detail: 'boom' },
    { id: 'c', name: 'C', what: 'w', flow: 'out', state: 'live', detail: 'Sending only' }]);
  assert.deepEqual(listConnections({ people: [], errors: {} }).map((x) => x.id), ['crm', 'whatsapp', 'email', 'calendar']);
});
