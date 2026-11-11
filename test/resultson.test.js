import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageOf, toPeople, isSoldNote, STAGES } from '../lib/resultson.js';

const label = (task, results = [], sold = false) => stageOf(task, results, sold).label;

test('pipeline order is the one the user gave', () => {
  assert.deepEqual(STAGES, ['Installment', 'Waiting for Payment', 'Thinking about it', 'No Show',
    'Meeting Confirmed', 'Meeting Booked', 'Answered', 'Not answered', 'New lead']);
});

test('specific signals win: installment, sold, after-consultation follow-up, cancelled', () => {
  assert.equal(label({ kind: 'splatka' }, ['potvrzeno'], true), 'Installment');
  assert.equal(label({ kind: 'call' }, ['potvrzeno'], true), 'Waiting for Payment');
  assert.equal(label({ kind: 'followup', followType: 'konzultace' }, ['potvrzeno']), 'Thinking about it');
  assert.equal(label({ kind: 'call', rule: 'Zrušení konzultace klientem → zavolat' }, ['potvrzeno']), 'No Show');
});

test('otherwise the furthest call result reached', () => {
  assert.equal(label({ kind: 'call' }, ['nedovolano', 'potvrzeno', 'nedovolano']), 'Meeting Confirmed');
  assert.equal(label({ kind: 'confirm', rule: 'Termín domluven → potvrdit 24 h předem' }, []), 'Meeting Booked');
  assert.equal(label({ kind: 'call' }, ['nedovolano', 'termin']), 'Meeting Booked');
  assert.equal(label({ kind: 'followup', followType: 'domluveny' }, ['nedovolano', 'triage']), 'Answered');
  assert.equal(label({ kind: 'call' }, ['follow']), 'Answered');
  assert.equal(label({ kind: 'call' }, ['nedovolano', 'nedovolano']), 'Not answered');
  assert.equal(label({ kind: 'call', rule: 'LTO nákup → volat do 5 minut (upsell)' }, []), 'New lead');
});

test('sold notes say "Prodáno", not "Neprodáno"', () => {
  assert.equal(isSoldNote('Středa 12. 3. — Prodáno UM (FULL) 44 000 Kč'), true);
  assert.equal(isSoldNote('prodano 14600'), true);
  assert.equal(isSoldNote('Neprodáno — nemá peníze'), false);
  assert.equal(isSoldNote(''), false);
  assert.equal(isSoldNote(null), false);
});

test('toPeople: soonest task leads, e164 phone, follow type and sold note used', () => {
  const tasks = [
    { task_id: 1, contact_id: 'a', name: 'Ana', kind: 'followup', rule_name: null, due_at: '2026-11-12T10:00:00Z', note: null },
    { task_id: 2, contact_id: 'a', name: 'Ana', kind: 'followup', rule_name: null, due_at: '2026-11-10T10:00:00Z', note: 'ring' },
    { task_id: 3, contact_id: 'b', name: 'Bo', kind: 'call', rule_name: null, due_at: '2026-11-11T10:00:00Z', note: null },
  ];
  const contacts = [
    { id: 'a', name: 'Ana', email: ' Ana@X.cz ', phone: '775 000 000', phone_e164: '+420775000000', funnel: 'BOOTCAMP' },
    { id: 'b', name: null, email: 'bo@x.cz', phone: '+420 600 000 000', phone_e164: null, funnel: null },
  ];
  const calls = [{ contact_id: 'a', vysledek: 'termin' }, { contact_id: 'b', vysledek: null, poznamka: null }];
  const notes = [{ contact_id: 'b', text: 'Prodáno UM 44 000 Kč' }];
  const [ana, bo] = toPeople(tasks, contacts, calls, notes, { 2: 'konzultace' });
  assert.deepEqual(ana.task, { kind: 'followup', rule: '', followType: 'konzultace', dueAt: '2026-11-10T10:00:00Z', note: 'ring' });
  assert.deepEqual(ana.emails, ['ana@x.cz']);
  assert.deepEqual(ana.phones, ['+420775000000']);
  assert.equal(ana.stage.label, 'Thinking about it');
  assert.equal(bo.name, 'Bo');
  assert.equal(bo.stage.label, 'Waiting for Payment');
});
