import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'outreach-ai-'));
process.env.OUTREACH_DATA_DIR = dir;
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
  for (const part of ['Pipeline stage: Thinking about it', 'Follow up · Po konzultaci', '(overdue)', 'Task note: Ozvat se po víkendu',
    'whatsapp (+420775623723), email (jana@x.cz)', 'WhatsApp · ME]\nDobrý den', 'Email · CLIENT] Subject: Cena\nKolik to stojí?',
    'Sent by me since the last sync', 'Posílám ceník', 'cancelled by the user · reason: "too pushy"', 'instruction for this draft\nshorter'])
    assert.ok(s.includes(part), part);
  assert.ok(s.indexOf('Dobrý den') < s.indexOf('Kolik'), 'oldest first');
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
    { kind: 'message', channel: 'email', subject: 'Re: Cena', text: 'Text', reasoning: 'why', templateId: 't1' });
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
