import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const dir = mkdtempSync(join(tmpdir(), 'outreach-lessons-'));
process.env.OUTREACH_DATA_DIR = dir;
process.env.TEMPLATES_IMPORT = '';
// A fake `claude -p`: logs each prompt to calls/, fails while `fail` exists, else edits the style guide.
const calls = join(dir, 'calls'), fail = join(dir, 'fail');
process.env.CLAUDE_BIN = join(dir, 'claude');
const answer = { summary: 'Shorter greetings', operations: [{ op: 'setStyle', reason: 'You shortened greetings', id: null, playbook: null, template: null, styleGuide: '# Styl\nPozdrav: Dobrý den.\nKrátce.' }] };
writeFileSync(process.env.CLAUDE_BIN, `#!/bin/sh\nmkdir -p ${calls}\ncat > ${calls}/$$\nif [ -e ${fail} ]; then echo '{"is_error":true,"result":"boom"}'; exit 0; fi\nprintf '%s' '${JSON.stringify({ structured_output: answer })}'\n`, { mode: 0o755 });
const coach = await import('../lib/coach.js');
const { listChanges } = await import('../lib/playbooks.js');
const { saveSettings, getSettings } = await import('../lib/settings.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const prompts = () => (existsSync(calls) ? readdirSync(calls).map((f) => readFileSync(join(calls, f), 'utf8')) : []);
const settle = async () => { await sleep(10); while (coach.coachState().learning) await sleep(20); };
const req = (i, extra = {}) => ({ id: `r${i}`, personName: `P${i}`, kind: 'message', channel: 'whatsapp', reasoning: 'nudge',
  aiText: `AI text ${i}`, aiSubject: '', text: `AI text ${i}`, subject: '', note: '', context: { stage: 'Answered', messages: [] }, ...extra });

test('decisions queue as lessons without a Claude call until the 15th, which runs once over all of them', async () => {
  saveSettings({ styleGuide: '# Styl\nPozdrav: Dobrý den, jak se máte?\nKrátce.' });
  for (let i = 1; i < coach.BATCH; i++) coach.learnFrom(req(i, { note: i === 3 ? 'too pushy' : '' }), i % 2 ? 'cancel' : 'approve');
  await settle();
  assert.equal(prompts().length, 0);
  assert.equal(coach.coachState().lessons, coach.BATCH - 1);
  assert.equal(coach.listLessons()[2].note, 'too pushy');
  coach.learnFrom(req(15), 'approve');
  await settle();
  const all = prompts();
  assert.equal(all.length, 1);
  assert.ok(all[0].includes('<lessons count="15">') && all[0].includes('AI text 1\n') && all[0].includes('AI text 15'));
  assert.ok(all[0].includes('<style>\n# Styl\nPozdrav: Dobrý den, jak se máte?'), 'the coach sees the style guide');
  assert.equal(coach.coachState().lessons, 0, 'lessons removed on success');
  const c = listChanges().at(-1);
  assert.deepEqual(c.trigger, { kind: 'batch', count: 15, notes: 1 });
  assert.equal(c.ops[0].op, 'setStyle');
  assert.equal(getSettings().styleGuide, answer.operations[0].styleGuide);
  const { at, ...last } = coach.coachState().last;
  assert.deepEqual(last, { count: 15, summary: 'Shorter greetings', changed: true });
});

test('a failed run keeps the lessons and retries at the next one; Learn now runs below 15', async () => {
  writeFileSync(fail, '');
  for (let i = 1; i <= coach.BATCH; i++) coach.learnFrom(req(i), 'cancel');
  await settle();
  assert.equal(prompts().length, 2);
  assert.match(coach.coachState().error, /boom/);
  assert.equal(coach.coachState().lessons, 15, 'kept on failure');
  coach.learnFrom(req(16), 'cancel');
  await settle();
  assert.equal(prompts().length, 3, 'retried at the next lesson');
  assert.equal(coach.coachState().lessons, 16);
  rmSync(fail);
  coach.learnNow();
  await settle();
  assert.equal(prompts().length, 4);
  assert.equal(coach.coachState().lessons, 0);
  assert.equal(coach.coachState().error, '');
  coach.learnNow(); // nothing waiting: no run
  await settle();
  assert.equal(prompts().length, 4);
});

test('an edited draft becomes a lesson with what the AI wrote and what the user sent', () => {
  const s = coach.learnInput(req(1, { text: 'Dobrý den, jak to vypadá?', aiText: 'Ahoj, už ses rozhodl?', subject: '' }), 'approve');
  assert.ok(s.includes('edited the draft before sending') && s.includes('<ai>Ahoj, už ses rozhodl?</ai>') && s.includes('<sent>Dobrý den, jak to vypadá?</sent>'));
  const r = coach.learnInput(req(1, { text: 'Moje verze', note: 'shorter' }), 'regenerate');
  assert.ok(r.includes('before asking for a new version') && r.includes('<edited>Moje verze</edited>'));
  const long = coach.learnInput(req(1, { context: { messages: [...Array(40)].map((_, i) => ({ channel: 'whatsapp', at: '2026-11-01T10:00:00Z', fromMe: i % 2, text: 'x'.repeat(5000) })) } }), 'cancel');
  assert.ok(long.length < 13000, 'a lesson stays bounded');
});
