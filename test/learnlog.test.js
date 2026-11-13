import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const dir = mkdtempSync(join(tmpdir(), 'outreach-learnlog-'));
process.env.OUTREACH_DATA_DIR = dir;
process.env.TEMPLATES_IMPORT = '';
// A fake `claude -p` answering with the JSON in answer.json; logs each prompt to calls/.
const calls = join(dir, 'calls'), answerFile = join(dir, 'answer.json');
process.env.CLAUDE_BIN = join(dir, 'claude');
writeFileSync(process.env.CLAUDE_BIN, `#!/bin/sh\nmkdir -p ${calls}\ncat > ${calls}/$$\nprintf '{"structured_output":%s}' "$(cat ${answerFile})"\n`, { mode: 0o755 });
const answer = (a) => writeFileSync(answerFile, JSON.stringify({ summary: 'S', questions: [], operations: [], handled: [], ...a }));
const coach = await import('../lib/coach.js');
const { listChanges } = await import('../lib/playbooks.js');
const { COACH_PROMPT } = await import('../lib/settings.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const prompts = () => (existsSync(calls) ? readdirSync(calls).map((f) => readFileSync(join(calls, f), 'utf8')) : []);
const settle = async () => { await sleep(10); while (coach.coachState().running || coach.coachState().queued || coach.coachState().quietAt) await sleep(20); };
const req = (i, extra = {}) => ({ id: `r${i}`, personName: `P${i}`, kind: 'message', channel: 'whatsapp', reasoning: 'nudge',
  aiText: `AI text ${i}`, aiSubject: '', text: `AI text ${i}`, subject: '', note: '', context: { stage: 'Not answered', messages: [] }, ...extra });
const playbook = { id: 'na', name: 'NA', stages: ['Not answered'], situation: 'no-reply', goal: '', steps: [{ id: 's1', channel: 'whatsapp', waitDays: 1, ask: 'ask later', why: 'w', templateIds: [] }], responses: [] };

test('what a lesson starts: BATCH runs now, a note or an edit waits for the quiet period, plain ones wait', () => {
  const l = (x = {}) => ({ note: '', edited: false, ...x });
  assert.equal(coach.whenToLearn([l()], l()), null);
  assert.equal(coach.whenToLearn([l({ note: 'x' })], l({ note: 'x' })), 'quiet');
  assert.equal(coach.whenToLearn([l({ edited: true })], l({ edited: true })), 'quiet');
  assert.equal(coach.whenToLearn(Array(coach.BATCH).fill(l()), l()), 'batch');
  assert.equal(coach.QUIET, 180_000);
});

test('handled entries map back to the lessons; a note the coach skipped is marked unanswered', () => {
  const lessons = [{ kind: 'regenerate', note: 'too soon', personName: 'A', input: 'x'.repeat(5000), requestId: 'q1' }, { kind: 'approve', note: '', personName: 'B', input: 'y' },
    { kind: 'approve', note: '', edited: true, personName: 'C', input: 'z' }];
  const e = coach.logEntry(lessons, { summary: 'S', handled: [{ lesson: 1, outcome: 'changed', what: 'NA, step 1: waits a day' }, { lesson: 1, outcome: 'already', what: 'dup' }, { lesson: 9, outcome: 'changed', what: 'nope' }] },
    { trigger: 'quiet', changeId: 'c1', at: 'T', id: 'run1' });
  assert.deepEqual({ ...e, handled: e.handled.map(({ id, input, ...h }) => h) }, { id: 'run1', at: 'T', trigger: 'quiet', count: 3, summary: 'S', changeId: 'c1', handled: [
    { lesson: 1, outcome: 'changed', what: 'NA, step 1: waits a day', note: 'too soon', edited: false, personName: 'A', decision: 'regenerate', requestId: 'q1' },
    { lesson: 3, outcome: 'unanswered', what: 'The coach gave no account of this one.', note: '', edited: true, personName: 'C', decision: 'approve', requestId: null },
  ] });
  assert.ok(e.handled[0].id && e.handled[0].input.length < 4100);
});

test('a noted lesson runs after the quiet period (reset by the next), alone, and is logged', async () => {
  coach.setQuiet(80);
  answer({ summary: 'Waits longer', operations: [{ op: 'setPlaybook', reason: 'note', id: null, playbook, template: null, styleGuide: null, rule: null }],
    handled: [{ lesson: 1, outcome: 'changed', what: 'NA, step 1: asks later' }, { lesson: 2, outcome: 'situational', what: 'He said he travels' }] });
  coach.learnFrom(req(1, { note: 'too soon' }), 'regenerate');
  await sleep(50);
  assert.ok(coach.coachState().quietAt, 'waiting for quiet');
  coach.learnFrom(req(2, { note: 'he is away' }), 'cancel');
  await sleep(50);
  assert.equal(prompts().length, 0, 'the second note reset the timer');
  await settle();
  const all = prompts();
  assert.equal(all.length, 1);
  assert.ok(all[0].includes('Lessons with a note or an edit (instructions; one "handled" entry each): 1, 2.'));
  assert.equal(coach.coachState().lessons, 0);
  const [run] = coach.listLearnLog();
  assert.equal(run.trigger, 'quiet'); assert.equal(run.changeId, listChanges().at(-1).id);
  assert.deepEqual(run.handled.map((h) => [h.lesson, h.outcome, h.note, h.personName, h.decision]),
    [[1, 'changed', 'too soon', 'P1', 'regenerate'], [2, 'situational', 'he is away', 'P2', 'cancel']]);
  assert.deepEqual(coach.coachState().log[0].id, run.id);
});

test('plain decisions do not start a run', async () => {
  coach.learnFrom(req(3), 'approve');
  await settle();
  assert.equal(prompts().length, 1);
  assert.equal(coach.coachState().lessons, 1);
  coach.learnNow();
  await settle();
  assert.equal(coach.listLearnLog()[0].trigger, 'now');
});

test('make general: one more run over that lesson alone, logged as "general", the original points at it', async () => {
  const run = coach.listLearnLog().find((x) => x.trigger === 'quiet'), h = run.handled[1];
  answer({ summary: 'General now', handled: [{ lesson: 1, outcome: 'changed', what: 'NA: a branch for travellers' }] });
  coach.makeGeneral(run.id, h.id);
  await settle();
  const p = prompts().find((x) => x.includes(coach.GENERAL));
  assert.ok(p && p.includes('<lessons count="1">') && p.includes('he is away'));
  const [g] = coach.listLearnLog();
  assert.equal(g.trigger, 'general');
  assert.equal(g.handled[0].what, 'NA: a branch for travellers');
  assert.equal(coach.listLearnLog().find((x) => x.id === run.id).handled[1].generalizedBy, g.id);
  assert.throws(() => coach.makeGeneral(run.id, h.id), /Already/);
  assert.throws(() => coach.makeGeneral('nope', 'x'), /Not in the learning log/);
});

test('the coach prompt treats notes as instructions and asks for every one to be accounted for', () => {
  assert.ok(COACH_PROMPT.includes("the note is the user's instruction, not a hint"));
  assert.ok(COACH_PROMPT.includes('"situational" must say what that is'));
  assert.ok(COACH_PROMPT.includes('For plain sends and cancels without a note, returning no operations is fine'));
  assert.ok(!/\. Returning no operations is fine/.test(COACH_PROMPT));
  assert.deepEqual(coach.OPS_SCHEMA.required, ['summary', 'operations', 'questions', 'handled']);
  assert.ok(coach.PLAYBOOK && coach.TEMPLATE && coach.RULE);
});
