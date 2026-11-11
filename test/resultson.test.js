import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageOf, toPeople } from '../lib/resultson.js';

const rank = (task, results = []) => stageOf(task, results).rank;

test('stage comes from the task kind and rule', () => {
  assert.equal(rank({ kind: 'splatka' }, ['nedovolano']), 1);
  assert.equal(rank({ kind: 'call', rule: 'LTO nákup → volat do 5 minut (upsell)' }), 2);
  assert.equal(rank({ kind: 'confirm', rule: 'Termín domluven → potvrdit 24 h předem' }), 4);
  assert.equal(rank({ kind: 'call', rule: 'Zrušení konzultace klientem → zavolat' }), 5);
  assert.equal(rank({ kind: 'call', rule: 'Dotazník vyplněn → volat do 5 minut' }), 8);
  assert.equal(rank({ kind: 'call', rule: 'Nový lead → volat do 5 minut' }), 9);
});

test('stage is the furthest call result reached, not the latest', () => {
  assert.equal(rank({ kind: 'followup' }, ['nedovolano', 'potvrzeno', 'nedovolano']), 3);
  assert.equal(rank({ kind: 'call' }, ['triage', 'follow']), 6);
  assert.equal(rank({ kind: 'call' }, ['triage']), 7);
  assert.equal(rank({ kind: 'call' }, ['nedovolano', 'nekvalif']), 9);
  assert.equal(stageOf({ kind: 'call' }, []).label, 'New / not reached yet');
});

test('toPeople: one person per contact, soonest task leads, e164 phone preferred', () => {
  const tasks = [
    { contact_id: 'a', name: 'Ana', kind: 'followup', rule_name: null, due_at: '2026-11-12T10:00:00Z', note: null },
    { contact_id: 'a', name: 'Ana', kind: 'call', rule_name: null, due_at: '2026-11-10T10:00:00Z', note: 'ring' },
    { contact_id: 'b', name: 'Bo', kind: 'call', rule_name: null, due_at: '2026-11-11T10:00:00Z', note: null },
  ];
  const contacts = [
    { id: 'a', name: 'Ana', email: ' Ana@X.cz ', phone: '775 000 000', phone_e164: '+420775000000', funnel: 'BOOTCAMP' },
    { id: 'b', name: null, email: 'bo@x.cz', phone: '+420 600 000 000', phone_e164: null, funnel: null },
  ];
  const calls = [{ contact_id: 'a', vysledek: 'termin' }, { contact_id: 'b', vysledek: null }];
  const [ana, bo] = toPeople(tasks, contacts, calls);
  assert.deepEqual(ana.task, { kind: 'call', rule: '', dueAt: '2026-11-10T10:00:00Z', note: 'ring' });
  assert.deepEqual(ana.emails, ['ana@x.cz']);
  assert.deepEqual(ana.phones, ['+420775000000']);
  assert.equal(ana.company, 'BOOTCAMP');
  assert.equal(ana.stage.rank, 4);
  assert.equal(bo.name, 'Bo');
  assert.deepEqual(bo.phones, ['+420 600 000 000']);
  assert.equal(bo.stage.rank, 9);
});
