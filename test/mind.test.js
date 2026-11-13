import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'outreach-mind-'));
process.env.OUTREACH_DATA_DIR = dir;
process.env.TEMPLATES_IMPORT = '';
const mind = await import('../lib/mind.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const msg = (at, fromMe, text) => ({ channel: 'whatsapp', id: at, at: `2026-11-${at}:00Z`, fromMe, text });
const person = { id: 'p', name: 'Jan Novák', stage: { label: 'No show' }, messages: [
  msg('01T10:00', true, 'Dobrý den, jak to jde?'),                       // first contact → quiet
  msg('01T11:00', false, 'Dobře, díky. Kdy můžeme?'),
  msg('01T11:05', true, 'Zítra v 18:00?'),                               // a reply
  msg('01T11:06', true, 'Nebo ve čtvrtek.'),                             // same run: not a new item
  msg('01T12:00', false, 'Bohužel teď ne, ozvu se. Volejte +420 777 123 456'),
  msg('01T12:30', true, 'Co Vám v tom brání?'),                          // a hard moment
  msg('05T09:00', true, 'Ještě se připomínám.'),                         // after 4 days of silence → quiet
  msg('05T09:10', false, '[image]'),
] };

test('corpus: replies, hard moments and follow-ups from my runs of messages; contacts anonymised', () => {
  const c = mind.corpus([person], [], { rules: [], questions: [] });
  assert.equal(c.replies.length, 1);
  assert.equal(c.hard.length, 1);
  assert.equal(c.quiet.length, 2);
  assert.match(c.hard[0].text, /<moment stage="No show">[\s\S]*CLIENT\] Bohužel teď ne[\s\S]*ME\] Co Vám v tom brání\?/);
  assert.match(c.hard[0].text, /<phone>/);
  assert.doesNotMatch(c.hard[0].text, /777/);
  assert.match(c.quiet[1].text, /silence="4 days"/);
  assert.match(c.quiet[0].text, /silence="first contact"/);
});

test("corpus: my corrections, answers and the rules I confirmed or wrote; never the AI's own guesses", () => {
  const ctx = { stage: 'No show', messages: [msg('01T12:00', false, 'Nemůžu přijít')] };
  const reqs = [
    { status: 'cancelled', note: 'challenge first', aiText: 'Nový termín?', text: 'Nový termín?', context: ctx, updatedAt: '2026-11-02T10:00:00Z' },
    { status: 'sent', aiText: 'Dobrý den', text: 'Ahoj', context: ctx, updatedAt: '2026-11-03T10:00:00Z' },
    { status: 'sent', aiText: 'Same', text: 'Same', context: ctx, updatedAt: '2026-11-03T11:00:00Z' }, // no signal
    { status: 'pending', note: 'x', text: 'y', context: ctx, updatedAt: '2026-11-03T12:00:00Z' },        // undecided
  ];
  const rules = [{ kind: 'rule', status: 'active', source: 'stated', when: 'he cancels', text: 'ask why first', because: '', updatedAt: '2026-11-04T00:00:00Z' },
    { kind: 'rule', status: 'active', source: 'inferred', when: '', text: 'AI guess', because: '', updatedAt: '2026-11-04T00:00:00Z' }];
  const questions = [{ status: 'answered', prompt: 'Push or wait?', case: '', options: [{ id: 'o1', label: 'Push' }], answer: { optionId: 'o1', text: 'if he is warm', at: '2026-11-05T00:00:00Z' } }];
  const d = mind.corpus([], reqs, { rules, questions }).decisions;
  assert.equal(d.length, 4);
  assert.match(d[0].text, /I cancelled it\. My note: "challenge first"/);
  assert.match(d[1].text, /AI's draft: Dobrý den\nI sent it\.\nMy version: Ahoj/);
  assert.match(d[2].text, /<said>\nI wrote: when he cancels: ask why first/);
  assert.match(d[3].text, /I answered: Push — if he is warm/);
  assert.ok(!d.some((x) => /AI guess/.test(x.text)));
});

test('the newest 15% is held out; packing keeps the newest within budget, in time order', () => {
  const items = [...Array(20)].map((_, i) => ({ at: `2026-11-${String(i + 1).padStart(2, '0')}`, text: 'x'.repeat(10) }));
  const { train, test: held } = mind.split(items);
  assert.deepEqual([train.length, held.length, held[0].at], [17, 3, '2026-11-18']);
  assert.equal(mind.split(items.slice(0, 5)).test.length, 0, 'too little to hold any back');
  const p = mind.pack(train, 35);
  assert.deepEqual(p.map((x) => x.at), ['2026-11-15', '2026-11-16', '2026-11-17']);
});

test('the portrait for drafts: without the items marked "not me", confirmed ones flagged, quotes only said/observed', () => {
  const ev = [{ quote: 'Co Vám brání?', label: 'observed' }, { quote: 'my reading', label: 'inferred' }];
  const d = { marks: { m2: { mark: 'not' }, h1: { mark: 'me' } }, portrait: {
    identity: 'I sell honestly.', limits: ['Based on 2 weeks'],
    models: [{ id: 'm1', name: 'Excuses hide doubts', line: 'Line.', apply: 'A.', limits: 'L.', evidence: ev }, { id: 'm2', name: 'Wrong one', line: '', apply: '', limits: '', evidence: [] }],
    heuristics: [{ id: 'h1', when: 'he cancels', then: 'ask why', case: 'c', evidence: [] }],
    conversation: [{ id: 'c1', lens: 'resistance', text: 'Challenges first.', thin: true, evidence: [] }],
    values: [], never: [], tensions: [{ id: 't1', between: 'Direct vs. kind', text: 'Kind wins when he is hurting.', evidence: [] }],
  } };
  const out = mind.renderMind(d);
  assert.match(out, /^I sell honestly\./);
  assert.match(out, /\[m1\] \*\*Excuses hide doubts\*\*: Line\. Applies: A\. Limits: L\. E\.g\. "Co Vám brání\?"/);
  assert.doesNotMatch(out, /my reading|Wrong one/);
  assert.match(out, /\[h1\] When he cancels: ask why \(case: c\) \(confirmed by the user\)/);
  assert.match(out, /resistance: Challenges first\. \(thin evidence\)/);
  assert.doesNotMatch(out, /## Values/, 'empty sections left out');
  assert.equal(mind.renderMind({ marks: {}, portrait: null }), '');
});

test('validation scores: blind order undone, points of 100 per dimension, portrait items relied on', () => {
  const cases = [{ dim: 'hard', at: 'a' }, { dim: 'hard', at: 'b' }, { dim: 'quiet', at: 'c' }];
  const W = new Map([[1, { ids: ['m1', 'm1'] }], [2, { ids: ['m1', 'h2'] }], [3, { ids: [] }]]);
  // case 2 is flipped: Y is the with-portrait prediction
  const s = mind.scoreValidation(cases, W, [{ n: 1, x: 'same', y: 'different' }, { n: 2, x: 'partly', y: 'different' }, { n: 3, x: 'partly', y: 'partly' }], [false, true, false]);
  assert.deepEqual([s.n, s.with, s.without], [3, 50, 33]);
  assert.deepEqual(s.dims.hard, { n: 2, with: 50, without: 25 });
  assert.deepEqual(s.items, { m1: { used: 2, right: 1 }, h2: { used: 1, right: 0 } });
});

test('test cases come only from the held-out newest moments and carry the situation and what I did', () => {
  const msgs = [];
  for (let d = 1; d <= 9; d++) msgs.push(msg(`${String(d).padStart(2, '0')}T10:00`, false, `Teď ne, ozvu se, den ${d}`), msg(`${String(d).padStart(2, '0')}T10:30`, true, `Co Vám brání? (${d})`));
  const cases = mind.testCases([{ id: 'x', stage: { label: 'No show' }, messages: msgs }], { requests: [], rules: [], questions: [] });
  assert.equal(cases.length, 1, '15% of 9 hard moments');
  assert.equal(cases[0].dim, 'hard');
  assert.match(cases[0].situation, /The client just wrote:[\s\S]*Teď ne, ozvu se, den 9/);
  assert.doesNotMatch(cases[0].situation, /\(9\)/, 'never what I did');
  assert.match(cases[0].actual, /ME\] Co Vám brání\? \(9\)/);
});
