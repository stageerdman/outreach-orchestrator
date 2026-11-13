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

test('drafts see facts and live rules (testing marked), never rejected ones', () => {
  const s = systemPrompt(getSettings(), []);
  assert.match(s, /## Facts about the offer\n- \[mine\] The consultation is free only this month/);
  assert.match(s, /\[wait-after-offer\] \(Thinking about it\) When an offer was sent: wait 3 days.*not confirmed yet/);
  assert.doesNotMatch(s, /send the link at once/);
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

test('an answer applies to the rule at once and queues a lesson; an A/B against it is only evidence', () => {
  const now = new Date(Date.now() + 10 * 864e5);
  for (const x of rules.openQuestions()) rules.closeQuestion(x.id, { status: 'answered' });
  setRule({ id: 'ab-rule', text: 'WhatsApp first', evidence: ev(2) });
  const [c, ab] = rules.addQuestions([
    { kind: 'confirm', ruleId: 'wait-after-offer', prompt: 'Is this how you decide?', case: 'x', options: [{ label: 'Yes', text: '', effect: 'confirm' }, { label: 'No', text: '', effect: 'reject' }] },
    { kind: 'ab', ruleId: 'ab-rule', prompt: 'Which would you send?', case: 'y', options: [{ label: 'A', text: 'Ahoj', effect: 'confirm' }, { label: 'B', text: 'Dobrý den', effect: 'reject' }] },
  ], now);
  const before = coach.listLessons().length;
  const out = coach.answerQuestion(c.id, { optionId: 'o1' });
  assert.equal(out.effect, 'confirm');
  assert.deepEqual([rules.getRule('wait-after-offer').status, rules.getRule('wait-after-offer').source], ['active', 'confirmed']);
  assert.equal(out.change.trigger.kind, 'answer');
  assert.equal(coach.answerQuestion(c.id, { optionId: 'o1' }), null, 'answered once');
  coach.answerQuestion(ab.id, { optionId: 'o2', text: 'formal for older men' });
  const r = rules.getRule('ab-rule');
  assert.equal(r.status, 'testing'); assert.equal(r.evidence.at(-1).for, false);
  const lessons = coach.listLessons().slice(before);
  assert.equal(lessons.length, 2);
  assert.match(lessons[1].input, /<answer kind="ab" rule="ab-rule">[\s\S]*The user chose: B[\s\S]*formal for older men/);
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

test('distill reads past decisions with a note or an edit and keeps only rule operations and questions', async () => {
  const ctx = { stage: 'No show', messages: [{ channel: 'whatsapp', at: '2026-11-11T10:00:00Z', fromMe: false, text: 'Nestihl jsem to' }] };
  const mk = (extra) => store.updateRequest(store.createRequest({ id: 'p1', name: 'Jan', task: null }, ctx, {}).id, { status: 'cancelled', text: 'Pošlu odkaz', aiText: 'Pošlu odkaz', ...extra });
  mk({ note: 'too soon for a link' }); mk({ status: 'sent', text: 'Kdy se Vám hodí?' }); mk({});
  assert.equal(coach.pastDecisions().length, 2, 'the plain cancel says nothing');
  answer({ summary: 'Found one', questions: [], operations: [
    { op: 'setRule', reason: 'note', id: null, playbook: null, template: null, styleGuide: null, rule: { id: 'no-link-early', kind: 'rule', when: 'after a no-show', text: 'ask before sending a link', because: 'too soon', stages: ['No show'], evidence: ev(2), fromAnswer: false } },
    { op: 'deletePlaybook', reason: 'x', id: 'nb', playbook: null, template: null, styleGuide: null, rule: null },
    { op: 'setPlaybook', reason: 'x', id: null, template: null, styleGuide: null, rule: null, playbook: { ...pb.getPlaybook('nb'), id: 'brand-new' } },
    { op: 'setTemplate', reason: 'x', id: null, playbook: null, styleGuide: null, rule: null, template: { id: 't-new', name: 'T', subject: '', body: 'Ahoj' } },
    { op: 'deleteRule', reason: 'about the message, moved to the playbook', id: 'nb-1', playbook: null, template: null, styleGuide: null, rule: null },
    { op: 'setPlaybook', reason: 'moved from a rule', id: null, template: null, styleGuide: null, rule: null, playbook: { ...pb.getPlaybook('nb'), goal: 'Rebook, no blame' } },
  ] });
  coach.distill();
  await settle();
  const p = prompts().at(-1);
  assert.match(p, /<decisions count="2">[\s\S]*too soon for a link/);
  assert.match(p, /What a rule is: how the user THINKS/, 'the thinking definition');
  assert.match(p, /<playbooks>[\s\S]*<style>/, 'where message matters go');
  assert.equal(rules.getRule('no-link-early').status, 'testing');
  assert.ok(pb.getPlaybook('nb'), 'distill never deletes playbooks');
  assert.equal(pb.getPlaybook('brand-new'), undefined, 'nor creates them');
  assert.equal(pb.getPlaybook('nb').goal, 'Rebook, no blame', 'a message rule moved into its playbook');
  assert.equal(rules.getRule('nb-1'), undefined, 'and left the rules');
  assert.equal(pb.listChanges().at(-1).trigger.kind, 'distill');
});

test("replay: past notes only, the user's decision hidden from the cases; scores with vs. without, fresh split, per rule", () => {
  const ctx = { stage: 'No show', messages: [{ channel: 'whatsapp', at: '2026-11-11T10:00:00Z', fromMe: false, text: 'Nemůžu přijít' }] };
  const mk = (extra) => store.updateRequest(store.createRequest({ id: 'p2', name: 'Petr', task: null }, ctx, {}).id, { channel: 'whatsapp', text: 'Nový termín?', aiText: 'Nový termín?', ...extra });
  mk({ status: 'cancelled', note: 'challenge him first' }); mk({ status: 'sent' });
  mk({ status: 'regenerated', note: 'he is not ready', text: 'Jak to vidíte?' });
  const cases = coach.replayCases().filter((c) => /Nemůžu/.test(c.input));
  assert.equal(cases.length, 2, 'only decisions with a note');
  assert.ok(cases.every((c) => /Nový termín\?/.test(c.input) && !/challenge|not ready|Jak to vidíte/.test(c.input)), "the AI's draft, never the user's note or edit");
  assert.match(cases[0].actual, /Cancelled it\. The user's note: "challenge him first"/);
  assert.match(cases[1].actual, /another version[\s\S]*Jak to vidíte/);
  rules.putRule('r1', { id: 'r1', kind: 'rule', when: '', text: 'x', because: '', stages: [], status: 'active', source: 'stated', evidence: [], createdAt: '', updatedAt: '' });
  const two = [{ at: '2026-11-01' }, { at: '2026-11-20' }];
  const withP = [{ n: 1, ruleIds: ['r1', 'gone'] }, { n: 2, ruleIds: ['r1'] }];
  // case 1: X = with rules (same), Y = without (different); case 2 flipped: X = without (partly), Y = with (same)
  const s = coach.scoreReplay(two, withP, [], [{ n: 1, x: 'same', y: 'different' }, { n: 2, x: 'partly', y: 'same' }], [false, true], '2026-11-10');
  assert.deepEqual(s.all, { n: 2, with: 2, without: 0.5 });
  assert.deepEqual(s.fresh, { n: 1, with: 1, without: 0.5 }, 'only decisions after the rules last changed');
  assert.deepEqual(s.rules, { r1: { cited: 2, right: 2 } }, 'unknown rule ids are ignored');
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

test('replay runs with and without rules, judges blind, keeps the result', async () => {
  const n = coach.replayCases().length;
  answer({ predictions: [...Array(n)].map((_, i) => ({ n: i + 1, decision: 'drop', thinking: 'too pushy', ruleIds: [] })),
    verdicts: [...Array(n)].map((_, i) => ({ n: i + 1, x: 'same', y: 'same' })) });
  const before = prompts().length;
  coach.replay();
  await settle();
  const ps = prompts().slice(before);
  assert.equal(ps.length, 3, 'with rules, without, the judge');
  assert.equal(ps.filter((p) => /# The user's rules/.test(p)).length, 1);
  assert.equal(ps.filter((p) => /<real>/.test(p)).length, 1, 'only the judge sees what the user did');
  const last = coach.listReplays().at(-1);
  assert.deepEqual([last.all.n, last.all.with, last.all.without], [n, n, n]);
});
