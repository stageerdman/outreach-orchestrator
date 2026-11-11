import { test } from 'node:test';
import assert from 'node:assert/strict';
import { styleCorpus, styleStats, anonymize, stylePromptInput } from '../lib/style.js';

const m = (at, fromMe, text, channel = 'whatsapp') => ({ channel, id: at, at, fromMe, text });

test('anonymize hides phones and emails', () => {
  assert.equal(anonymize('Volejte +420 775 623 723 nebo jana@x.cz'), 'Volejte <phone> nebo <email>');
});

test('client message then my reply is a pair; my messages in a row are one reply', () => {
  const { pairs, followups, count } = styleCorpus([{ stage: { label: 'New lead' }, messages: [
    m('2026-11-01T10:00:00Z', false, 'Dobrý den, mám zájem'),
    m('2026-11-01T10:05:00Z', true, 'Dobrý den!'),
    m('2026-11-01T10:06:00Z', true, 'Kdy se Vám hodí hovor?'),
  ] }]);
  assert.equal(count, 2);
  assert.equal(pairs.length, 1); assert.equal(followups.length, 0);
  assert.deepEqual(pairs[0], { channel: 'whatsapp', stage: 'New lead', at: '2026-11-01T10:05:00Z',
    me: 'Dobrý den!\n\nKdy se Vám hodí hovor?', client: 'Dobrý den, mám zájem' });
});

test('a reply after a day of client silence, or with no client message, is a follow-up', () => {
  const { pairs, followups } = styleCorpus([{ messages: [
    m('2026-11-01T10:00:00Z', true, 'Ahoj, ozvu se'),
    m('2026-11-02T10:00:00Z', false, 'Ok'),
    m('2026-11-05T10:00:00Z', true, 'Tak co, rozhodla ses?'),
    m('2026-11-05T10:01:00Z', false, '[image]'),
  ] }]);
  assert.equal(pairs.length, 0);
  assert.deepEqual(followups.map((f) => f.me), ['Ahoj, ozvu se', 'Tak co, rozhodla ses?']);
});

test('stats are per channel and measured, not guessed', () => {
  const s = styleStats([m('a', true, 'Ahoj 😊 jak se máš?'), m('b', true, 'Ahoj, díky!'), m('c', true, 'Dobrý den', 'email')]);
  assert.equal(s.whatsapp.messages, 2); assert.equal(s.email.messages, 1);
  assert.equal(s.whatsapp.emojiPerMessage, 0.5);
  assert.equal(s.whatsapp.withQuestionPct, 50);
  assert.deepEqual(s.whatsapp.topOpenings, ['Ahoj (2)']);
});

test('the prompt puts the data first and the instructions last', () => {
  const s = stylePromptInput({ stats: {}, pairs: [{ channel: 'email', stage: 'x', at: '2026-11-01T00:00:00Z', client: 'c', me: 'm' }], followups: [] }, 'INSTR');
  assert.match(s, /^<stats>/); assert.match(s, /INSTR$/);
  assert.ok(s.includes('<pair id="1" channel="email" stage="x" date="2026-11-01">\n<client>c</client>\n<me>m</me>'));
});
