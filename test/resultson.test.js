import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageOf, toPeople, isSoldNote, isConsultedNote, isNoShowNote, isBookedNote, isInstallmentNote, STAGES } from '../lib/resultson.js';

const label = (task, results = [], flags = {}) => stageOf(task, results, flags).label;

test('pipeline order is the one the user gave', () => {
  assert.deepEqual(STAGES, ['Installment', 'Waiting for Payment', 'Thinking about it', 'No Show',
    'Meeting Confirmed', 'Meeting Booked', 'Answered', 'Not answered', 'New lead']);
});

test('specific signals win: installment, sold, after-consultation follow-up, cancelled', () => {
  assert.equal(label({ kind: 'splatka' }, ['potvrzeno'], { sold: true }), 'Installment');
  assert.equal(label({ kind: 'call' }, ['potvrzeno'], { sold: true }), 'Waiting for Payment');
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
  assert.equal(isSoldNote('Domluveno — čeká se na platbu: Umění milovat'), true);
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

test('a consultation that happened (no sale yet) is Thinking about it, even with a later missed call', () => {
  assert.equal(label({ kind: 'call', followType: 'domluveny' }, ['nedovolano'], { consulted: true }), 'Thinking about it');
  assert.equal(label({ kind: 'call' }, ['termin', 'neprodej']), 'Thinking about it');
  assert.equal(label({ kind: 'call' }, [], { consulted: true, noShow: true }), 'Thinking about it');
  for (const t of ['Bez nabídky — Nemá finance — Jsme domluvení na followup za měsíc', 'Neprodáno — nemá peníze',
    'Konzultace bez nabídky — x', ' | uzavřeno: schůzka už proběhla (show_no_offer)', 'uzavřeno: schůzka už proběhla (show_offer)'])
    assert.ok(isConsultedNote(t), t);
  for (const t of ['Prodej — UM PRO', 'Odbaveno — x', 'Jsme bez nabídky zatím', '', null]) assert.ok(!isConsultedNote(t), t);
});

test('a no-show from notes or task notes is No Show, above call results', () => {
  assert.equal(label({ kind: 'call' }, ['nedovolano', 'nedovolano'], { noShow: true }), 'No Show');
  for (const t of ['Nedorazil (no-show)', 'Kvalifikovat a potvrdit termín — rezervoval si sám. | Nedorazil na free konzultaci (1×).',
    ' | uzavřeno: schůzka už proběhla (no_show)']) assert.ok(isNoShowNote(t), t);
  assert.ok(!isNoShowNote('Odbaveno — přišel včas'));
});

test('toPeople reads no-show and consultation signals from notes and closed tasks', () => {
  const tasks = [
    { task_id: 1, contact_id: 'j', name: 'Jiří', kind: 'call', due_at: '2026-11-11T10:00:00Z', note: 'Kvalifikovat | Nedorazil na free konzultaci (1×).' },
    { task_id: 2, contact_id: 'm', name: 'Michal', kind: 'call', due_at: '2026-11-04T10:00:00Z', note: 'Follow-up z kartotéky' },
    { task_id: 3, contact_id: 'k', name: 'Karel', kind: 'call', due_at: '2026-11-04T10:00:00Z', note: '' },
  ];
  const calls = ['j', 'm', 'k'].map((id) => ({ contact_id: id, vysledek: 'nedovolano' }));
  const notes = [{ contact_id: 'm', text: 'Bez nabídky — Nemá finance — Jsme domluvení na followup za měsíc' }];
  const past = [{ id: 9, contact_id: 'k', note: ' | uzavřeno: schůzka už proběhla (no_show)' }];
  const people = toPeople(tasks, [], calls, notes, { 2: 'domluveny' }, past);
  assert.deepEqual(Object.fromEntries(people.map((p) => [p.name, p.stage.label])), { Jiří: 'No Show', Michal: 'Thinking about it', Karel: 'No Show' });
});

test('a later "lost" note cancels waiting for payment; an earlier one does not', () => {
  const tasks = [{ task_id: 1, contact_id: 'z', name: 'Z', kind: 'call', due_at: '2026-11-01T00:00:00Z' },
    { task_id: 2, contact_id: 'y', name: 'Y', kind: 'call', due_at: '2026-11-02T00:00:00Z' }];
  const notes = [
    { contact_id: 'z', created_at: '2026-10-07T00:00:00Z', text: 'Uzavřeno jako ztracené — Vybral konkurenci' },
    { contact_id: 'z', created_at: '2026-10-06T00:00:00Z', text: 'Domluveno — čeká se na platbu: Umění milovat' },
    { contact_id: 'y', created_at: '2026-10-01T00:00:00Z', text: 'Uzavřeno jako ztracené — x' },
    { contact_id: 'y', created_at: '2026-10-09T00:00:00Z', text: 'Domluveno — čeká se na platbu: UM PRO' },
  ];
  const [z, y] = toPeople(tasks, [], [], notes);
  assert.equal(z.stage.label, 'New lead');
  assert.equal(y.stage.label, 'Waiting for Payment');
});

test('a booked meeting from notes or task notes is Meeting Booked, even with only a "follow" call', () => {
  for (const t of ['Domluvená schůzka 12. 11. 10:00', ' | uzavřeno: klient má domluvenou schůzku', 'Kvalifikovat a potvrdit termín — rezervoval si sám.'])
    assert.ok(isBookedNote(t), t);
  assert.ok(!isBookedNote('Napsal na WA, že bude řídit'));
  const tasks = [{ task_id: 2, contact_id: 'f', name: 'Flori', kind: 'call', due_at: '2026-11-10T00:00:00Z', note: 'Kvalifikovat a potvrdit termín — rezervoval si sám.' }];
  const [f] = toPeople(tasks, [], [{ contact_id: 'f', vysledek: 'follow' }]);
  assert.equal(f.stage.label, 'Meeting Booked');
});

test('installment is the person\'s stage: a closed installment task or sale note keeps a new call task there', () => {
  for (const t of ['Prodej na splátky — UM PRO · 2× 5 000 Kč', 'Upraveny platby: UM PRO · 30 000 Kč v 3 platbách']) assert.ok(isInstallmentNote(t), t);
  assert.ok(!isInstallmentNote('Prodej — UM PRO'));
  const tasks = [{ task_id: 5, contact_id: 't', name: 'Tomáš', kind: 'call', due_at: '2026-11-10T00:00:00Z', note: 'Odloženo z fronty' },
    { task_id: 6, contact_id: 'n', name: 'Nora', kind: 'call', due_at: '2026-11-10T00:00:00Z' },
    { task_id: 7, contact_id: 'p', name: 'Paid', kind: 'call', due_at: '2026-11-10T00:00:00Z' }];
  const past = [{ id: 1, contact_id: 't', kind: 'splatka', note: 'Splátka 2/3' }, { id: 2, contact_id: 'p', kind: 'splatka' }];
  const notes = [{ contact_id: 'n', created_at: '2026-10-20T00:00:00Z', text: 'Prodej na splátky — UM PRO' }];
  const people = toPeople(tasks, [{ id: 'p', paid: true }], [{ contact_id: 't', vysledek: 'triage' }], notes, {}, past);
  assert.deepEqual(Object.fromEntries(people.map((p) => [p.name, p.stage.label])), { Tomáš: 'Installment', Nora: 'Installment', Paid: 'New lead' });
});
