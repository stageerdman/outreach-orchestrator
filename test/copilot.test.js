import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'outreach-copilot-'));
process.env.OUTREACH_DATA_DIR = dir;
process.env.WHATSAPP_DB = join(dir, 'none.db'); // no bridge: every number counts as on WhatsApp
// A fake `claude` that logs its args and stdin, then streams turn.jsonl (or sleeps when told).
const calls = join(dir, 'calls'), turn = join(dir, 'turn.jsonl');
process.env.CLAUDE_BIN = join(dir, 'claude');
writeFileSync(process.env.CLAUDE_BIN, `#!/bin/sh\n{ printf '%s\\n' "$@"; echo ---; cat; echo ===; } >> ${calls}\nif [ -f ${dir}/slow ]; then exec sleep 30; fi\ncat ${turn}\n`, { mode: 0o755 });
// A turn as the CLI streams it: the answer's JSON in small input_json_delta chunks, then the result.
const answer = (a) => {
  const s = JSON.stringify(a), chunks = s.match(/.{1,7}/gs);
  writeFileSync(turn, [{ type: 'system', subtype: 'init' }, { type: 'stream_event', event: { type: 'message_start' } },
    ...chunks.map((c) => ({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: c } } })),
    { type: 'result', is_error: false, structured_output: a }].map((x) => JSON.stringify(x)).join('\n') + '\n');
};
const ACTION = { type: null, reason: null, channel: null, subject: null, text: null, templateId: null, playbookId: null, stepId: null, reasoning: null, playbook: null, template: null, styleGuide: null, rule: null };
const act = (x) => ({ ...ACTION, ...x });

const person = { id: 'c1', name: 'Jana Nová', emails: ['jana@x.cz'], phones: ['+420775623723'], stage: { label: 'Thinking about it' },
  messages: [{ channel: 'whatsapp', id: 'w1', at: '2026-11-01T10:00:00Z', fromMe: false, text: 'Ještě si to rozmyslím' }] };
const { setJSON } = await import('../lib/cache.js');
setJSON('snapshot', { at: null, people: [person, { ...person, id: 'c2', name: 'Petr' }] });
(await import('../lib/sync.js')).restoreSnapshot();
const cp = await import('../lib/copilot.js');
const store = await import('../lib/requests.js');
const pb = await import('../lib/playbooks.js');
const { getMind, removeNote } = await import('../lib/mind.js');
const { events } = await import('../lib/events.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));
const lastCall = () => readFileSync(calls, 'utf8').split('===\n').filter(Boolean).at(-1).split('\n---\n');

test('the partial-JSON extractor reads strings cut off anywhere', () => {
  const full = JSON.stringify({ thinking: 'Řekla "ne"\nteď', reply: 'Ok é 😀 \\ done', actions: [] });
  for (let i = 0; i <= full.length; i++) {
    const t = cp.partialString(full.slice(0, i), 'thinking'), r = cp.partialString(full.slice(0, i), 'reply');
    assert.ok('Řekla "ne"\nteď'.startsWith(t), `thinking at ${i}: ${t}`);
    assert.ok('Ok é 😀 \\ done'.startsWith(r), `reply at ${i}: ${r}`);
  }
  assert.equal(cp.partialString('{"thinking":"a\\u00', 'thinking'), 'a');
  assert.equal(cp.partialString('{"thinking":"a\\', 'thinking'), 'a');
  assert.equal(cp.partialString('{"thinking":"say \\"reply\\": \\"x', 'reply'), '', 'a key inside a string is not the key');
  assert.equal(cp.partialString('{"thinking":"x", "reply" : "hi', 'reply'), 'hi');
  assert.equal(cp.partialString('{"thinking":"\\ud83d', 'thinking'), '', 'half a surrogate pair waits');
});

test('a turn streams its thinking and reply, then a draft action becomes the pending draft', async () => {
  const seen = [];
  const on = (e) => seen.push(e); events.on('copilot', on);
  answer({ thinking: 'She is hesitating; shorter and warmer.', reply: 'Zkrátil jsem to.', actions: [act({ type: 'draft', channel: 'whatsapp', subject: 'x', text: 'Ahoj Jano, jak to vidíte?', reasoning: 'shorter' })] });
  await cp.say('c1', 'napiš to kratší');
  events.off('copilot', on);
  const { items, running } = cp.getCopilot('c1');
  assert.equal(running, false);
  assert.deepEqual(items.map((i) => [i.kind, i.text]), [['user', 'napiš to kratší'], ['ai', 'Zkrátil jsem to.'], ['action', 'Draft written']]);
  assert.equal(items[1].thinking, 'She is hesitating; shorter and warmer.');
  const partials = seen.filter((e) => 'reply' in e);
  assert.ok(partials.length >= 1 && partials.every((e) => e.id === items[1].id && e.running), 'streamed under the ai item\'s id');
  assert.equal(partials.at(-1).reply, 'Zkrátil jsem to.');
  const r = store.getRequest(items[2].requestId);
  assert.deepEqual([r.status, r.channel, r.subject, r.text, r.aiText, r.instruction, r.via, r.previousId], ['pending', 'whatsapp', '', 'Ahoj Jano, jak to vidíte?', 'Ahoj Jano, jak to vidíte?', 'napiš to kratší', 'copilot', null]);
  const [args, input] = lastCall();
  for (const a of ['--output-format\nstream-json', '--include-partial-messages', '--no-session-persistence', '--tools\n\n']) assert.ok(args.includes(a), a);
  assert.match(args, /# Copilot/);
  assert.match(input, /# The draft in front of the user\n\(none yet\)/);
  assert.match(input, /# The user's new message\nnapiš to kratší\n\nWrite "thinking" in English and "reply" in Czech\.$/);
  assert.ok(!input.includes('Prepare the next step'));
});

test('a second draft replaces the pending one as a new version; the chat so far is in the prompt', async () => {
  const old = store.listRequests().find((r) => r.personId === 'c1' && r.status === 'pending');
  answer({ thinking: '', reply: 'Hotovo.', actions: [act({ type: 'draft', channel: 'email', subject: '', text: 'Dobrý den, …' })] });
  await cp.say('c1', 'radši e-mailem');
  const [, input] = lastCall();
  assert.match(input, /\[WhatsApp · as you wrote it\]\nAhoj Jano/);
  assert.match(input, /USER: napiš to kratší\nYOU: Zkrátil jsem to.\nDONE: Draft written/);
  const prev = store.getRequest(old.id), item = cp.getCopilot('c1').items.at(-1);
  assert.deepEqual([prev.status, prev.note, prev.via], ['regenerated', 'radši e-mailem', 'copilot']);
  const r = store.getRequest(item.requestId);
  assert.deepEqual([item.text, item.previousId, r.previousId, r.channel, r.instruction], ['Draft updated', old.id, old.id, 'email', 'radši e-mailem']);
  // Sending or cancelling it later: the chat's messages along the chain are the lesson's note.
  const { lessonOf } = await import('../lib/assistant.js');
  assert.equal(lessonOf(r.id).note, 'napiš to kratší / radši e-mailem');
});

test('a draft being written is left alone', async () => {
  const g = store.createRequest({ ...person, id: 'c2' }, null, { status: 'generating' });
  answer({ thinking: '', reply: 'ok', actions: [act({ type: 'draft', channel: 'whatsapp', text: 'Ahoj' })] });
  await cp.say('c2', 'změň to');
  const item = cp.getCopilot('c2').items.at(-1);
  assert.deepEqual([item.kind, item.ok, item.text], ['action', false, 'A draft is still being written; left it as it is']);
  assert.equal(store.getRequest(g.id).status, 'generating');
  assert.equal(store.listRequests().filter((r) => r.personId === 'c2').length, 1);
  store.updateRequest(g.id, { status: 'cancelled' });
});

test('a playbook change is applied, logged with trigger copilot and undoable; remember saves a note', async () => {
  const playbook = { id: 'thinking', name: 'Thinking about it', stages: ['Thinking about it'], situation: 'no-reply', goal: 'decide',
    steps: [{ id: 'step-1', channel: 'whatsapp', waitDays: 2, ask: 'Ask what holds them back', why: 'w', templateIds: [] }], responses: [] };
  answer({ thinking: 'A general rule.', reply: 'Změnil jsem playbook a zapamatoval si to.', actions: [
    act({ type: 'setPlaybook', reason: 'Wait 3 days first', playbook: { ...playbook, steps: [{ ...playbook.steps[0], waitDays: 3 }] } }),
    act({ type: 'remember', text: 'Hesitation means fear of the price, not of the result.' }),
  ] });
  await cp.say('c1', 'od teď vždycky počkej 3 dny');
  const items = cp.getCopilot('c1').items.slice(-2);
  assert.equal(items[0].text, "Playbook 'Thinking about it' added: Wait 3 days first");
  const change = pb.listChanges().at(-1);
  assert.deepEqual([items[0].changeId, change.trigger], [change.id, { kind: 'copilot', personName: 'Jana Nová' }]);
  assert.equal(pb.getPlaybook('thinking').steps[0].waitDays, 3);
  assert.deepEqual(getMind().notes.at(-1), { ...getMind().notes.at(-1), text: 'Hesitation means fear of the price, not of the result.', source: 'copilot' });
  assert.equal(items[1].text, 'Remembered: “Hesitation means fear of the price, not of the result.”');
  assert.equal(items[1].noteAt, getMind().notes.at(-1).at);
  assert.equal(removeNote(items[1].noteAt), true); // Undo
  assert.equal(getMind().notes.some((n) => n.at === items[1].noteAt), false);
  assert.equal(pb.undoChange(change.id).change.undone, true);
  assert.equal(pb.getPlaybook('thinking'), undefined);
});

test('one turn at a time per person; Stop ends it; clear starts over', async () => {
  writeFileSync(join(dir, 'slow'), '');
  const p = cp.say('c1', 'think hard');
  assert.equal(cp.getCopilot('c1').running, true);
  assert.throws(() => cp.say('c1', 'and this'), (e) => e.status === 409);
  assert.throws(() => cp.clear('c1'), /Stop it first/);
  while (!readFileSync(calls, 'utf8').includes('think hard')) await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(cp.stop('c1'), true);
  await p;
  rmSync(join(dir, 'slow'));
  assert.deepEqual(cp.getCopilot('c1').items.at(-1).text, 'Stopped.');
  writeFileSync(turn, JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' }) + '\n');
  await cp.say('c1', 'again');
  assert.deepEqual([cp.getCopilot('c1').items.at(-1).kind, cp.getCopilot('c1').items.at(-1).text], ['error', 'Not logged in']);
  assert.deepEqual(cp.clear('c1'), { items: [], running: false });
  assert.throws(() => cp.say('nobody', 'hi'), (e) => e.status === 404);
});

test('the reply language follows the user, not the client', async () => {
  const { langOf } = await import('../lib/copilot.js');
  assert.equal(langOf('what step are we at?'), 'English');
  assert.equal(langOf('zkrať to'), 'Czech');
  assert.equal(langOf('udělej to kratší'), 'Czech');
});
