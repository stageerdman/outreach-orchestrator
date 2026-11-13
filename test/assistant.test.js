import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'outreach-ai-'));
process.env.OUTREACH_DATA_DIR = dir;
process.env.WHATSAPP_DB = join(dir, 'none.db'); // no bridge: every number counts as on WhatsApp
// A fake `claude -p` that always answers with a WhatsApp message.
process.env.CLAUDE_BIN = join(dir, 'claude');
writeFileSync(process.env.CLAUDE_BIN, `#!/bin/sh\ncat >/dev/null\necho '${JSON.stringify({ structured_output: {
  action: 'message', channel: 'whatsapp', subject: 'S', text: 'Ahoj', templateId: null, playbookId: null, stepId: null, reasoning: '' } })}'\n`, { mode: 0o755 });
const ai = await import('../lib/assistant.js');
const store = await import('../lib/requests.js');
const { claudeArgs } = await import('../lib/claude.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const person = {
  id: 'c1', name: 'Jana Nová', company: 'LTO', emails: ['jana@x.cz'], phones: ['+420775623723'],
  stage: { rank: 3, label: 'Thinking about it' },
  task: { kind: 'followup', rule: 'Po konzultaci', dueAt: '2026-11-10T09:00:00Z', note: 'Ozvat se po víkendu' },
  messages: [
    { channel: 'whatsapp', id: 'w1', at: '2026-11-01T10:00:00Z', fromMe: true, text: 'Dobrý den, posílám odkaz' },
    { channel: 'email', id: 'e1', at: '2026-11-02T10:00:00Z', fromMe: false, subject: 'Cena', text: 'Kolik to stojí?' },
  ],
};

const onWa = () => true, noWa = () => false;

test('channels are the first phone (WhatsApp) and email', () => {
  assert.deepEqual(ai.channelsOf(person, onWa), { whatsapp: '+420775623723', email: 'jana@x.cz' });
  assert.deepEqual(ai.channelsOf({ ...person, phones: [] }, onWa), { email: 'jana@x.cz' });
});

test('a number not on WhatsApp is dropped when there is an email, kept (and flagged) when not', () => {
  assert.deepEqual(ai.channelsOf(person, noWa), { email: 'jana@x.cz' });
  assert.deepEqual(ai.channelsOf({ ...person, phones: ['+1', '+420775623723'] }, (ph) => ph === '+420775623723'),
    { whatsapp: '+420775623723', email: 'jana@x.cz' });
  assert.deepEqual(ai.channelsOf({ ...person, emails: [] }, noWa), { whatsapp: '+420775623723' });
  const s = ai.contextPrompt({ person, onWa: noWa });
  assert.ok(s.includes('Available channels: email (jana@x.cz)\nWhatsApp: +420775623723 was not found on WhatsApp'));
  assert.ok(!ai.contextPrompt({ person, onWa }).includes('not found on WhatsApp'));
});

test('context has the task, history, unsent drafts with reasons, and the instruction', () => {
  const drafts = [{ status: 'cancelled', kind: 'message', channel: 'whatsapp', createdAt: '2026-11-09T08:00:00Z', text: 'Ahoj, už jste se rozhodla?', note: 'too pushy' }];
  const sent = [{ channel: 'email', updatedAt: '2026-11-11T08:00:00Z', subject: 'Re: Cena', text: 'Posílám ceník' }];
  const s = ai.contextPrompt({ person, drafts, sent, instruction: 'shorter', now: new Date('2026-11-11T12:00:00Z'), onWa });
  for (const part of ['Category (stage): Thinking about it', 'Follow up · Po konzultaci', '(overdue)', 'Task note: Ozvat se po víkendu',
    'whatsapp (+420775623723), email (jana@x.cz)', 'WhatsApp · ME]\nDobrý den', 'Email · CLIENT] Subject: Cena\nKolik to stojí?',
    'Sent by me since the last sync', 'Posílám ceník', 'cancelled by the user · reason: "too pushy"', 'instruction for this draft\nshorter'])
    assert.ok(s.includes(part), part);
  assert.ok(s.indexOf('Dobrý den') < s.indexOf('Kolik'), 'oldest first');
});

test('a draft the user edited reaches the next draft as the user\'s version', () => {
  const drafts = [{ status: 'regenerated', kind: 'message', channel: 'whatsapp', createdAt: '2026-11-09T08:00:00Z', aiText: 'Ahoj, jak to jde?', text: 'Dobrý den, jak to vypadá?', note: 'more formal' }];
  const s = ai.contextPrompt({ person, drafts, onWa });
  assert.ok(s.includes('the user asked for a new version · the user edited it: this is their version · reason: "more formal"]\nDobrý den, jak to vypadá?'), s);
});

test('times in the context are Prague time, whatever the local timezone', () => {
  const s = ai.contextPrompt({ person, now: new Date('2026-11-11T23:30:00Z'), onWa });
  assert.ok(s.startsWith('Now: 2026-11-12 00:30 (Thursday). All times here are Prague time'), s.split('\n')[0]);
  assert.ok(s.includes('due 2026-11-10 10:00'));
  assert.ok(s.includes('[2026-11-01 11:00 · WhatsApp · ME]'));
});

test('system prompt carries the style guide and templates as plain text', () => {
  const s = ai.systemPrompt({ draftPrompt: 'MY PROMPT', stylePrompt: '', styleGuide: 'Píše krátce.' },
    [{ id: 't1', name: 'Po konzultaci', subject: 'Díky', bodyHtml: '<p>Ahoj {{ JMENO }}</p>' }]);
  assert.match(s, /^MY PROMPT/);
  assert.ok(s.includes('# Style guide\nPíše krátce.'));
  assert.ok(s.includes('## t1 · Po konzultaci\nSubject: Díky\nAhoj {{ JMENO }}'));
});

test('a draft keeps only valid channel and template, subject only for email messages', () => {
  const tpls = [{ id: 't1' }];
  const base = { action: 'message', channel: 'email', subject: ' Re: Cena ', text: ' Text ', templateId: 't1', reasoning: 'why' };
  assert.deepEqual(ai.toDraft(base, ['whatsapp', 'email'], tpls),
    { kind: 'message', channel: 'email', subject: 'Re: Cena', text: 'Text', reasoning: 'why', templateId: 't1', playbookId: null, stepId: null, ruleIds: [] });
  const rules = [{ id: 'r1', kind: 'fact', status: 'active' }, { id: 'r2', kind: 'fact', status: 'rejected' }, { id: 'r3', kind: 'rule', status: 'active' }];
  assert.deepEqual(ai.toDraft({ ...base, ruleIds: ['r1', 'r2', 'r3', 'gone', 'r1'] }, ['email'], tpls, [], rules).ruleIds, ['r1'], 'known, live facts (and portrait items) only');
  const d = ai.toDraft({ ...base, channel: 'email', templateId: 'gone' }, ['whatsapp'], tpls);
  assert.equal(d.channel, 'whatsapp'); assert.equal(d.subject, ''); assert.equal(d.templateId, null);
  assert.equal(ai.toDraft({ ...base, action: 'meeting' }, ['email'], tpls).kind, 'meeting');
  assert.equal(ai.toDraft({ ...base, action: 'meeting' }, ['email'], tpls).subject, '');
  assert.deepEqual(ai.draftSchema(['email']).properties.channel.enum, ['email']);
});

test('a person with a draft on the way or waiting is busy; sent and cancelled are not', () => {
  const list = [
    { personId: 'a', status: 'generating' }, { personId: 'b', status: 'pending' },
    { personId: 'c', status: 'sent' }, { personId: 'c', status: 'cancelled' }, { personId: 'd', status: 'failed' },
  ];
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => store.isBusy(id, list)), [true, true, false, false]);
});

test('unsent drafts skip sent, failed and empty ones; sentSince is after the last sync', () => {
  const list = [
    { personId: 'a', status: 'cancelled', text: 'x' }, { personId: 'a', status: 'regenerated', text: 'y' },
    { personId: 'a', status: 'sent', text: 'z', updatedAt: '2026-11-11T10:00:00Z' }, { personId: 'a', status: 'failed', text: '' },
    { personId: 'a', status: 'sent', text: 'old', updatedAt: '2026-11-01T10:00:00Z' }, { personId: 'b', status: 'pending', text: 'w' },
  ];
  assert.deepEqual(store.unsentDrafts('a', list).map((r) => r.text), ['x', 'y']);
  assert.deepEqual(store.sentSince('a', '2026-11-05T00:00:00Z', list).map((r) => r.text), ['z']);
});

test('requests are stored, updated and survive as a list', () => {
  const r = store.createRequest(person);
  assert.equal(r.status, 'generating');
  assert.ok(store.isBusy('c1'));
  store.updateRequest(r.id, { status: 'cancelled', note: 'no' });
  assert.equal(store.getRequest(r.id).note, 'no');
  assert.ok(!store.isBusy('c1'));
});

test('a closed request cannot be cancelled or regenerated again', () => {
  const r = store.createRequest(person);
  store.updateRequest(r.id, { status: 'sent' });
  assert.equal(ai.cancel(r.id, 'x'), null);
  assert.equal(ai.regenerate(r.id, 'x'), null);
});

test('claude runs with no tools, structured output and the chosen model', () => {
  const a = claudeArgs({ system: 'S', schema: { type: 'object' }, model: 'opus' });
  assert.deepEqual(a.slice(0, 8), ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--system-prompt']);
  assert.ok(a.includes('--json-schema') && a.at(-1) === 'opus');
});

test('a draft keeps the context the AI saw: stage, task and the last 30 messages, clipped', () => {
  const many = Array.from({ length: 35 }, (_, i) => ({ channel: 'whatsapp', id: `m${i}`, at: `2026-11-01T10:${String(i).padStart(2, '0')}:00Z`, fromMe: false, text: i === 34 ? 'x'.repeat(2000) : `t${i}` }));
  const c = ai.contextOf({ ...person, task: { ...person.task, id: 7 }, messages: many });
  assert.equal(c.stage, 'Thinking about it'); assert.equal(c.task.id, 7);
  assert.equal(c.messages.length, 30); assert.equal(c.messages[0].id, 'm5');
  assert.ok(c.messages.at(-1).text.endsWith(' …') && c.messages.at(-1).text.length < 1300);
  const r = store.createRequest({ ...person, task: { id: 7 } }, c);
  assert.equal(r.taskId, 7); assert.equal(r.context.messages.length, 30);
});

test('a cancelled draft is recoverable only while its task exists and nothing was sent or is waiting', () => {
  const p = { ...person, task: { id: 7 }, messages: [{ channel: 'email', id: 'e', at: '2026-11-02T10:00:00Z', fromMe: true, text: 'old' }] };
  const r = { id: 'r1', personId: 'c1', status: 'cancelled', kind: 'message', channel: 'email', text: 'Hi', taskId: 7, createdAt: '2026-11-05T10:00:00Z' };
  const why = (over = {}, people = [p], list = []) => ai.recoverBlock({ ...r, ...over }, people, list, onWa);
  assert.equal(why(), '');
  assert.equal(why({ taskId: null }), '', 'old drafts without a task id: any open task will do');
  assert.equal(why({ status: 'sent' }), 'Only cancelled drafts can be recovered');
  assert.equal(why({ text: '' }), 'Cancelled before a draft was written');
  assert.equal(why({}, []), 'No open task for this person any more');
  assert.equal(why({ taskId: 6 }), 'The task it was for is closed');
  assert.equal(why({}, [p], [{ personId: 'c1', status: 'pending' }]), 'Another draft for this person is waiting');
  assert.equal(why({}, [p], [{ personId: 'c1', status: 'sent', updatedAt: '2026-11-06T00:00:00Z' }]), 'A later draft was sent');
  assert.equal(why({}, [p], [{ personId: 'c1', status: 'sent', updatedAt: '2026-11-04T00:00:00Z' }]), '', 'a send before the draft does not count');
  assert.equal(why({}, [{ ...p, messages: [...p.messages, { fromMe: true, at: '2026-11-06T00:00:00Z' }] }]), 'You wrote to them since');
  assert.equal(why({}, [p], [{ recoveredFrom: 'r1', status: 'sent', personId: 'x' }]), 'Already recovered');
  assert.equal(why({ channel: 'whatsapp' }, [{ ...p, phones: [] }]), "WhatsApp isn't available for this person any more");
  assert.equal(why({ kind: 'meeting', channel: 'whatsapp' }, [{ ...p, phones: [] }]), '');
});

test('follow-up position: my touches since the client last wrote, close messages count once', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  const m = (at, fromMe, channel = 'whatsapp') => ({ channel, at, fromMe, text: '' });
  const f = ai.followupState([m('2026-11-01T10:00:00Z', false), m('2026-11-02T10:00:00Z', true), m('2026-11-02T10:05:00Z', true),
    m('2026-11-05T10:00:00Z', true, 'email'), m('2026-11-08T10:00:00Z', true)], now);
  assert.deepEqual(f, { followups: 3, clientEverWrote: true, daysSinceClient: 10, daysSinceMine: 3, channels: ['whatsapp', 'email', 'whatsapp'] });
  assert.equal(ai.renderFollowup(f), '3 message(s) sent since the client last wrote (whatsapp → email → whatsapp), the last 3 day(s) ago. The client last wrote 10 day(s) ago.');
  assert.equal(ai.renderFollowup(ai.followupState([], now)), 'No messages yet: first contact.');
  assert.equal(ai.followupState([m('2026-11-08T10:00:00Z', true)], now).clientEverWrote, false);
  assert.ok(ai.contextPrompt({ person, now, onWa }).includes('Follow-up position: The client wrote last; nothing sent since. The client last wrote 9 day(s) ago.'));
});

test('a draft names the playbook step it followed, only if that step exists', () => {
  const pbs = [{ id: 'na', steps: [{ id: 's1' }], responses: [{ id: 'no-time' }] }];
  const base = { action: 'message', channel: 'whatsapp', subject: '', text: 'x', templateId: null, reasoning: '', playbookId: 'na', stepId: 's1' };
  assert.deepEqual([ai.toDraft(base, ['whatsapp'], [], pbs)].map((d) => [d.playbookId, d.stepId]), [['na', 's1']]);
  assert.equal(ai.toDraft({ ...base, stepId: 'no-time' }, ['whatsapp'], [], pbs).stepId, 'no-time');
  assert.equal(ai.toDraft({ ...base, stepId: 'zzz' }, ['whatsapp'], [], pbs).stepId, null);
  assert.equal(ai.toDraft({ ...base, playbookId: 'gone' }, ['whatsapp'], [], pbs).playbookId, null);
  const sys = ai.systemPrompt({ draftPrompt: 'P', stylePrompt: '', styleGuide: '' }, [], [{ id: 'na', name: 'NA', stages: [], situation: 'no-reply', goal: '', steps: [], responses: [], lessons: [] }]);
  assert.ok(sys.includes('# Playbooks\nOur follow-up strategy') && sys.includes('## na · NA'));
  assert.ok(!ai.systemPrompt({ draftPrompt: 'P', stylePrompt: '', styleGuide: '' }, [], []).includes('# Playbooks'));
});

test('a draft can be held to one channel; an unknown one leaves the choice to the AI', () => {
  assert.deepEqual(ai.draftChannels(person, 'email', onWa), ['email']);
  assert.deepEqual(ai.draftChannels(person, null, onWa), ['whatsapp', 'email']);
  assert.deepEqual(ai.draftChannels(person, 'whatsapp', noWa), ['email']);
});

test('reply subject: Re: the last email, once', () => {
  assert.equal(ai.replySubject(person.messages), 'Re: Cena');
  assert.equal(ai.replySubject([{ channel: 'email', subject: 'Re: RE: Cena' }]), 'Re: Cena');
  assert.equal(ai.replySubject([]), '');
});

test('switching a waiting draft\'s channel fills or clears the subject, only to channels the person has', () => {
  const r = store.createRequest(person, null, { status: 'pending', channel: 'whatsapp', text: 'Ahoj' });
  assert.deepEqual([ai.editRequest(r.id, { channel: 'email' }, [person], onWa)].map((x) => [x.channel, x.subject, x.text]), [['email', 'Re: Cena', 'Ahoj']]);
  assert.equal(ai.editRequest(r.id, { channel: 'whatsapp' }, [person], onWa).subject, '');
  assert.throws(() => ai.editRequest(r.id, { channel: 'email' }, [{ ...person, emails: [] }], onWa), /Email isn't available/);
  store.updateRequest(r.id, { status: 'cancelled' });
});

test('a draft keeps its channel and instruction; regenerate links the new version to the old', async () => {
  const { setJSON } = await import('../lib/cache.js');
  const { restoreSnapshot } = await import('../lib/sync.js');
  setJSON('snapshot', { at: null, people: [{ ...person, id: 'c9' }] });
  restoreSnapshot();
  const settle = async (id) => { for (let i = 0; i < 100 && store.getRequest(id).status === 'generating'; i++) await new Promise((ok) => setTimeout(ok, 20)); return store.getRequest(id); };
  const [first] = ai.draft(['c9'], 'kratší', { channel: 'email' });
  assert.deepEqual([first.channel, first.instruction, first.previousId], ['email', 'kratší', null]);
  const done = await settle(first.id);
  assert.equal(done.status, 'pending', done.error);
  assert.equal(done.channel, 'email', 'the AI answered WhatsApp, held to email');
  store.updateRequest(first.id, { status: 'failed' }); // a failed one: regenerate skips playbook learning
  const next = ai.regenerate(first.id, 'hezčí');
  assert.equal(store.getRequest(first.id).note, 'hezčí');
  assert.deepEqual([next.previousId, next.instruction, next.channel], [first.id, 'hezčí', null]);
  assert.equal((await settle(next.id)).channel, 'whatsapp');
  // "Draft with: <template>": the AI is told which one; the request shows it while it's written.
  store.updateRequest(next.id, { status: 'cancelled' });
  const [withTpl] = ai.draft(['c9'], '', { templateId: 'tpl-1' });
  assert.deepEqual([withTpl.templateId, withTpl.instruction], ['tpl-1', 'Use template tpl-1.']);
  await settle(withTpl.id);
  store.updateRequest(withTpl.id, { status: 'cancelled' });
});

test('a regenerate sees every earlier version: each instruction, the AI text and the user\'s edit', () => {
  const v1 = { id: 'v1', status: 'regenerated', kind: 'message', channel: 'email', createdAt: '2026-11-09T08:00:00Z', instruction: 'mention the discount',
    aiText: 'Hi Jana, 10% off.', aiSubject: 'Offer', text: 'Dear Jana, 10% off.', subject: 'Offer', note: 'shorter' };
  const v2 = { id: 'v2', status: 'regenerated', kind: 'message', channel: 'email', createdAt: '2026-11-09T09:00:00Z', instruction: 'shorter', previousId: 'v1',
    aiText: '10% off.', aiSubject: 'Offer', text: '10% off.', subject: 'Offer', note: 'keep the greeting' };
  const all = { v1, v2 }, revisions = ai.revisionsOf({ id: 'v3', previousId: 'v2' }, (id) => all[id]);
  assert.deepEqual(revisions.map((r) => r.id), ['v1', 'v2']);
  const s = ai.contextPrompt({ person, drafts: [v1, v2], revisions, instruction: 'keep the greeting', onWa });
  for (const part of ['you are writing version 3', '## Version 1', 'The user asked: "mention the discount"', 'You wrote (Email):\nSubject: Offer\nHi Jana, 10% off.',
    'The user edited it to:\nSubject: Offer\nDear Jana, 10% off.', '## Version 2', 'The user asked: "shorter"', '## Version 3 (now)\nThe user asked: "keep the greeting"'])
    assert.ok(s.includes(part), part);
  assert.ok(!s.includes('Your earlier drafts'), 'the chain is not repeated in the drafts list');
  assert.ok(!s.slice(s.indexOf('## Version 2')).includes('edited it to'), 'an unedited version has no edit');
  assert.ok(!s.includes('instruction for this draft'));
});

test('free calendar time reaches the prompt only when there is some', () => {
  const person = { id: 'p', name: 'A', phones: [], emails: ['a@x.cz'], messages: [] };
  assert.ok(ai.contextPrompt({ person, availability: 'Mon 16/11: 09:00–12:00' }).includes('# My free time'));
  assert.ok(!ai.contextPrompt({ person }).includes('# My free time'));
});

test('the scenario opens the context, right after the time, with its templates and the template-first rule', async () => {
  const { scenarioOf } = await import('../lib/scenario.js');
  const pbs = [{ id: 'th', name: 'Thinking', stages: ['Thinking about it'], situation: 'conversation', goal: '', steps: [],
    responses: [{ id: 'price', when: 'he asks the price', approach: 'explain', templateIds: ['t1'] }], lessons: [] }];
  const templates = [{ id: 't1', name: 'Cena', subject: '', bodyHtml: '<div>Dobrý den {{ JMENO }}</div>' }];
  const scenario = scenarioOf(person, pbs, new Date('2026-11-11T12:00:00Z'));
  const s = ai.contextPrompt({ person, scenario, templates, now: new Date('2026-11-11T12:00:00Z'), onWa });
  const parts = s.split('\n\n');
  assert.match(parts[0], /^Now: /);
  assert.ok(parts[1].startsWith('# Scenario\n'), parts[1]);
  assert.ok(s.indexOf('# Scenario') < s.indexOf('# Client'));
  assert.ok(s.includes('Thinking about it · the client wrote last · pick the reply branch that fits (1): he asks the price'));
  assert.ok(s.includes('### t1 · Cena\nDobrý den {{ JMENO }}') && s.includes('When templates are listed, use one'));
  assert.ok(!ai.contextPrompt({ person, scenario: null, onWa }).includes('# Scenario'));
  assert.deepEqual(ai.contextOf(person, new Date('2026-11-11T12:00:00Z'), scenario).scenario,
    { playbookId: 'th', stepId: null, situation: 'conversation', text: scenario.text });
});

test('the draft prompt sets the order of authority: instruction > scenario > portrait > style; the user\'s own prompt still wins', async () => {
  const { DRAFT_PROMPT, prompts } = await import('../lib/settings.js');
  const at = (x) => DRAFT_PROMPT.indexOf(x);
  assert.ok(at("1. The user's instruction") < at('2. The playbook scenario') && at('2. The playbook scenario') < at('3. The portrait') && at('3. The portrait') < at('4. The style guide'));
  assert.ok(DRAFT_PROMPT.includes('Templates first: when the scenario lists templates, use one'));
  assert.equal(prompts({ draftPrompt: ' MINE ' }).draft, 'MINE');
  const sys = ai.systemPrompt({ draftPrompt: '', styleGuide: '' }, [], [], [], 'portrait');
  assert.ok(sys.includes('may justify a deviation') && !sys.includes('outranks the playbooks'));
});
