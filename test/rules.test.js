import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const dir = mkdtempSync(join(tmpdir(), 'outreach-rules-'));
process.env.OUTREACH_DATA_DIR = dir;
process.env.TEMPLATES_IMPORT = '';
// A fake `claude -p` answering with the JSON in answer.json; logs each prompt to calls/.
const calls = join(dir, 'calls'), answerFile = join(dir, 'answer.json');
process.env.CLAUDE_BIN = join(dir, 'claude');
writeFileSync(process.env.CLAUDE_BIN, `#!/bin/sh\nmkdir -p ${calls}\n{ printf '%s\\n' "$@"; cat; } > ${calls}/$$\nprintf '{"structured_output":%s}' "$(cat ${answerFile})"\n`, { mode: 0o755 });
const answer = (a) => writeFileSync(answerFile, JSON.stringify(a));
const rules = await import('../lib/rules.js');
const pb = await import('../lib/playbooks.js');
const coach = await import('../lib/coach.js');
const store = await import('../lib/requests.js');
const { systemPrompt } = await import('../lib/assistant.js');
const { getSettings } = await import('../lib/settings.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));
const prompts = () => (existsSync(calls) ? readdirSync(calls).map((f) => readFileSync(join(calls, f), 'utf8')) : []);
const settle = async () => { await sleep(10); while (coach.coachState().running || coach.coachState().queued) await sleep(20); };

const ev = (n, against = 0) => [...Array(n)].map((_, i) => ({ for: true, text: `case ${i}` })).concat([...Array(against)].map(() => ({ for: false, text: 'other' })));
const setRule = (rule, kind = 'batch') => pb.applyOperations([{ op: 'setRule', reason: 'r', rule }], { trigger: { kind } });

test("an AI rule is testing until 4 decisions support it with none against; it can't claim the user's word", () => {
  setRule({ id: 'Wait after offer', when: 'an offer was sent', text: 'wait 3 days', because: '', stages: ['Thinking about it', 'Nope'], evidence: ev(3), source: 'stated', status: 'active' });
  let r = rules.getRule('wait-after-offer');
  assert.equal(r.status, 'testing'); assert.equal(r.source, 'inferred');
  assert.deepEqual(r.stages, ['Thinking about it']);
  setRule({ id: 'wait-after-offer', text: 'wait 3 days', evidence: ev(1) });
  assert.equal(rules.getRule('wait-after-offer').status, 'active', '4 for, none against');
  setRule({ id: 'wait-after-offer', text: 'wait 3 days', evidence: ev(0, 1) });
  assert.equal(rules.getRule('wait-after-offer').status, 'testing', 'one against: back to testing');
  assert.equal(rules.getRule('wait-after-offer').evidence.length, 5);
});

test("the AI can only add evidence to a rule the user confirmed, can't revive a rejected one or delete the user's", () => {
  setRule({ id: 'mine', kind: 'fact', text: 'The consultation is free only this month', source: 'stated' }, 'user');
  assert.deepEqual([rules.getRule('mine').status, rules.getRule('mine').source], ['active', 'stated']);
  setRule({ id: 'mine', kind: 'fact', text: 'The consultation is always free', evidence: [{ for: false, text: 'x' }] });
  assert.equal(rules.getRule('mine').text, 'The consultation is free only this month');
  assert.equal(rules.getRule('mine').evidence.length, 1);
  assert.equal(rules.getRule('mine').status, 'active');
  assert.equal(pb.applyOperations([{ op: 'deleteRule', id: 'mine' }], { trigger: { kind: 'batch' } }), null);
  setRule({ id: 'nope', text: 'send the link at once', status: 'rejected', source: 'confirmed' }, 'user');
  assert.equal(setRule({ id: 'nope', text: 'send the link at once', evidence: ev(5) }), null);
  assert.equal(rules.getRule('nope').status, 'rejected');
});

test('rule changes are logged and undone like the rest', () => {
  const c = setRule({ id: 'undo-me', text: 'call first' }, 'user');
  assert.equal(c.ops[0].op, 'setRule');
  assert.ok(pb.undoChange(c.id).change);
  assert.equal(rules.getRule('undo-me'), undefined);
  const d = pb.applyOperations([{ op: 'deleteRule', id: 'nope' }]);
  assert.ok(pb.undoChange(d.id).change);
  assert.equal(rules.getRule('nope').status, 'rejected');
});

test('questions: at most 3 open, one per rule, one batch a day, fewer after skips', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  const q = (ruleId, prompt) => ({ kind: 'confirm', ruleId, prompt, case: 'Klient: …', options: [{ label: 'Yes', text: '', effect: 'confirm' }, { label: 'No', text: '', effect: 'reject' }] });
  const out = rules.addQuestions([q('wait-after-offer', 'a'), q('wait-after-offer', 'b'), q('nope', 'rejected'), q(null, 'c'), q(null, 'd'), q(null, 'e')], now);
  assert.deepEqual(out.map((x) => x.prompt), ['a', 'c', 'd']);
  assert.equal(out[1].options[0].effect, 'none', 'no rule: no effect');
  assert.deepEqual(rules.addQuestions([q(null, 'f')], new Date(+now + 3600e3)), [], 'one batch a day');
  for (const x of out) rules.closeQuestion(x.id, { status: 'skipped' });
  assert.equal(rules.addQuestions([q(null, 'g'), q(null, 'h')], new Date(+now + 2 * 864e5)).length, 1, 'after 3 skips: one');
});

test("once: the playbooks' lessons become rules scoped to the playbook, the playbooks keep none", () => {
  pb.applyOperations([{ op: 'setPlaybook', playbook: { id: 'nb', name: 'No show', stages: ['No show'], situation: 'no-reply', goal: '', steps: [], responses: [], lessons: ['No blame', 'Two slots'] } }]);
  const c = coach.migrateLessons();
  assert.equal(c.trigger.kind, 'migrate');
  assert.deepEqual(pb.getPlaybook('nb').lessons, []);
  const r = rules.getRule('nb-2');
  assert.deepEqual([r.when, r.text, r.stages, r.status, r.source], ['the client stopped replying', 'Two slots', ['No show'], 'active', 'inferred']);
  assert.equal(coach.migrateLessons(), null, 'only once');
  setRule({ id: 'nb-2', evidence: ev(1) });
  assert.equal(rules.getRule('nb-2').status, 'active', 'support from a run keeps a migrated rule active');
  setRule({ id: 'nb-2', evidence: ev(0, 1) });
  assert.equal(rules.getRule('nb-2').status, 'testing', 'a case against puts it back to testing');
});

test('fidelity: drafts sent as the AI wrote them, per Prague week', () => {
  const r = (status, at, extra = {}) => ({ status, updatedAt: at, text: 'a', aiText: 'a', ...extra });
  const f = coach.fidelity([
    r('sent', '2026-11-09T00:30:00+01:00'), r('sent', '2026-11-12T10:00:00Z', { text: 'b' }), r('cancelled', '2026-11-13T10:00:00Z'),
    r('sent', '2026-11-08T22:30:00Z'), // Sunday 23:30 in Prague: the week before
    r('generating', '2026-11-13T10:00:00Z'), r('pending', '2026-11-13T10:00:00Z'),
  ]);
  assert.deepEqual(f, [{ week: '2026-11-09', decided: 3, asIs: 1 }, { week: '2026-11-02', decided: 1, asIs: 1 }]);
});

