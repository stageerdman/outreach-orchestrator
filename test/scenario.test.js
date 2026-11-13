import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'outreach-scenario-'));
process.env.OUTREACH_DATA_DIR = dir;
process.env.TEMPLATES_IMPORT = '';
const { scenarioOf, renderScenario, scenarioSummary, followupState } = await import('../lib/scenario.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const step = (id, waitDays, templateIds = [], channel = 'whatsapp') => ({ id, channel, waitDays, ask: `ask ${id}`, why: `why ${id}`, templateIds });
const resp = (id, templateIds = []) => ({ id, when: `when ${id}`, approach: `do ${id}`, templateIds });
const pb = (id, stages, situation, steps = [], responses = []) => ({ id, name: id.toUpperCase(), stages, situation, goal: '', steps, responses, lessons: [] });
const playbooks = [
  pb('na', ['Not answered', 'New lead'], 'no-reply', [step('s1', 0, ['t1']), step('s2', 2, ['t2']), step('s3', 3, [], 'email')], [resp('busy', ['t3']), resp('price')]),
  pb('thinking', ['Thinking about it'], 'conversation', [step('t1', 1)], [resp('think', ['t3']), resp('busy', ['t9'])]),
  pb('any', [], 'no-reply', [step('u1', 2, ['tu'])], [resp('busy'), resp('stop', ['t4'])]),
];
const now = new Date('2026-11-13T12:00:00Z');
const m = (at, fromMe, channel = 'whatsapp') => ({ channel, at, fromMe, text: 'x' });
const person = (label, messages) => ({ stage: { label }, messages });

test('first contact: step 1 of the stage playbook, due now', () => {
  const s = scenarioOf(person('Not answered', []), playbooks, now);
  assert.equal(s.situation, 'first-contact');
  assert.equal(s.playbookId, 'na');
  assert.deepEqual(s.step, { id: 's1', n: 1, of: 3, channel: 'whatsapp', ask: 'ask s1', why: 'why s1', waitDays: 0, dueInDays: 0 });
  assert.deepEqual(s.templateIds, ['t1']);
  assert.equal(s.text, 'Not answered · first contact · step 1 of 3 (WhatsApp, due now): ask s1');
});

test('no reply: touches since the client last wrote give the step, the wait gives when it is due', () => {
  const msgs = [m('2026-11-01T10:00:00Z', false), m('2026-11-10T10:00:00Z', true), m('2026-11-10T10:05:00Z', true)];
  const s = scenarioOf(person('Not answered', msgs), playbooks, now);
  assert.equal(s.situation, 'no-reply');
  assert.equal(s.step.n, 2); assert.equal(s.step.id, 's2');
  assert.equal(s.step.dueInDays, -1, '2 days wait, 3 days since my last message');
  assert.match(s.text, /step 2 of 3 \(WhatsApp, due now\)/);
  const soon = scenarioOf(person('Not answered', [m('2026-11-01T10:00:00Z', false), m('2026-11-13T09:00:00Z', true)]), playbooks, now);
  assert.equal(soon.step.dueInDays, 2);
  assert.match(soon.text, /due in 2 day\(s\)/);
});

test('past the last step the sequence is finished', () => {
  const msgs = [m('2026-11-01T10:00:00Z', true), m('2026-11-03T10:00:00Z', true), m('2026-11-06T10:00:00Z', true)];
  const s = scenarioOf(person('New lead', msgs), playbooks, now);
  assert.equal(s.step, null);
  assert.equal(s.situation, 'first-contact');
  assert.match(s.text, /the sequence is finished/);
  assert.match(renderScenario(s, []), /Send nothing more unless/);
});

test('a stage without its own sequence falls back to the universal playbook (legacy names mapped)', () => {
  const s = scenarioOf(person('No show', [m('2026-11-01T10:00:00Z', false), m('2026-11-02T10:00:00Z', true)]), playbooks, now);
  assert.equal(s.playbookId, 'any');
  assert.equal(s.step, null, 'one step, one touch sent: finished');
  const t = scenarioOf(person('Thinking about it', [m('2026-11-01T10:00:00Z', false), m('2026-11-12T10:00:00Z', true)]), playbooks, now);
  assert.deepEqual([t.playbookId, t.step], ['thinking', null], "the stage's own sequence wins, even when finished");
  assert.equal(scenarioOf(person('Answered', [m('2026-11-01T10:00:00Z', false), m('2026-11-12T10:00:00Z', true)]), [playbooks[0]], now), null, 'nothing fits');
  assert.equal(scenarioOf(person('Not answered', []), [], now), null);
});

test('the client wrote last: candidates are the stage branches plus the universal ones, deduped', () => {
  const s = scenarioOf(person('Thinking about it', [m('2026-11-01T10:00:00Z', true), m('2026-11-12T10:00:00Z', false)]), playbooks, now);
  assert.equal(s.situation, 'conversation');
  assert.equal(s.playbookId, 'thinking'); assert.equal(s.step, null);
  assert.deepEqual(s.candidates.map((c) => [c.id, c.playbookId]), [['think', 'thinking'], ['busy', 'thinking'], ['stop', 'any']]);
  assert.deepEqual(s.templateIds, ['t3', 't9', 't4']);
  assert.match(s.text, /^Thinking about it · the client wrote last · pick the reply branch/);
  const u = scenarioOf(person('No show', [m('2026-11-12T10:00:00Z', false)]), playbooks, now);
  assert.equal(u.playbookId, 'any');
});

test('the prompt block names the step, its templates by id and name, and the template-first rule', () => {
  const templates = [{ id: 't2', name: 'Druhý', subject: '', bodyHtml: '<div>Dobrý den {{ JMENO }}</div>' }, { id: 'x', name: 'Other', bodyHtml: 'no' }];
  const s = scenarioOf(person('Not answered', [m('2026-11-01T10:00:00Z', false), m('2026-11-10T10:00:00Z', true)]), playbooks, now);
  const out = renderScenario(s, templates);
  assert.match(out, /^# Scenario\n/);
  assert.ok(out.includes('use one: keep its wording, fill its placeholders'));
  assert.ok(out.includes('## Step [s2], 2 of 3\nChannel: WhatsApp · wait 2 day(s) after our last message · due now\nAsk: ask s2\nWhy: why s2'));
  assert.ok(out.includes('### t2 · Druhý\nDobrý den {{ JMENO }}'));
  assert.ok(!out.includes('Other'));
  assert.deepEqual(scenarioSummary(s), { playbookId: 'na', stepId: 's2', situation: 'no-reply', text: s.text });
  assert.equal(renderScenario(null), '');
  assert.equal(scenarioSummary(null), null);
});

test('followupState lives here (assistant re-exports it)', async () => {
  const ai = await import('../lib/assistant.js');
  assert.equal(ai.followupState, followupState);
});
