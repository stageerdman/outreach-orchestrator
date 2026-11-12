import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMeeting, activeBookings, facts, needsConfirm, hidden, merge, classify, callNow, colorOf, pragueDay } from '../lib/fronta.js';

// 11:00 Prague (CET) on 12 Nov 2026.
const NOW = Date.parse('2026-11-12T10:00:00Z');
const H = 36e5;
const iso = (ms) => new Date(ms).toISOString();
const me = { id: 'me', jmeno: 'Stage' };
const base = { ...facts({}, NOW), pendingDeletion: false, nerelevantni: false };
let n = 0;
const row = (o = {}, ctx = {}) => ({ task_id: ++n, contact_id: o.contact_id ?? `c${n}`, kind: 'call', due_at: iso(NOW - H), attempts: 0, note: '',
  assigned_to: null, follow_typ: null, created_by: null, locked_by: null, locked_at: null, campaign: null, ...o, ctx: { ...base, ...ctx } });
const group = (r) => classify(r, me.id, NOW)[1];
const ev = (event, occurred, meta = {}, id = ++n) => ({ id, contact_id: 'x', event, occurred_at: iso(occurred), meta });

test('meeting_at: GHL text and zoneless ISO are Prague time, ISO with a zone as is', () => {
  assert.equal(parseMeeting('October 21, 2026 3:00 PM').toISOString(), '2026-10-21T13:00:00.000Z'); // CEST
  assert.equal(parseMeeting('Wednesday, November 18, 2026 12:30 AM').toISOString(), '2026-11-17T23:30:00.000Z'); // CET
  assert.equal(parseMeeting('November 18, 2026 12:00 PM').toISOString(), '2026-11-18T11:00:00.000Z');
  assert.equal(parseMeeting('2026-08-19T08:00').toISOString(), '2026-08-19T06:00:00.000Z');
  assert.equal(parseMeeting('2026-10-02T06:00:00.000Z').toISOString(), '2026-10-02T06:00:00.000Z');
  assert.equal(parseMeeting('2026-12-01T09:00:00+01:00').toISOString(), '2026-12-01T08:00:00.000Z');
  assert.equal(parseMeeting('soon'), null);
  assert.equal(parseMeeting(null), null);
  assert.equal(pragueDay(Date.parse('2026-11-12T23:30:00Z')), '2026-11-13');
});

test('active bookings: same time = one, cancelled drops out, same appointment_id = one, past ignored', () => {
  const t1 = '2026-11-20T09:00:00Z', t2 = '2026-11-21T09:00:00Z';
  assert.equal(activeBookings([ev('call_booked', NOW - 5 * H, { meeting_at: t1 }), ev('call_booked', NOW - 4 * H, { meeting_at: t2 })], NOW).length, 2);
  // the app's reschedule without an id and GHL's echo with one, same time
  assert.equal(activeBookings([ev('appointment_rescheduled', NOW - 5 * H, { meeting_at: t1 }), ev('call_booked', NOW - 4 * H, { meeting_at: t1, appointment_id: 'A' })], NOW).length, 1);
  assert.equal(activeBookings([ev('call_booked', NOW - 5 * H, { meeting_at: t1 }), ev('call_booked', NOW - 4 * H, { meeting_at: t2 }),
    ev('appointment_cancelled', NOW - 3 * H, { meeting_at: t1 })], NOW).length, 1);
  // GHL move keeps the appointment_id and never cancels the old time
  assert.deepEqual(activeBookings([ev('call_booked', NOW - 5 * H, { meeting_at: t1, appointment_id: 'A' }), ev('call_booked', NOW - 4 * H, { meeting_at: t2, appointment_id: 'A' })], NOW).map(iso), [t2.replace('Z', '.000Z')]);
  // an app reschedule without an id belongs to the last known meeting
  assert.equal(activeBookings([ev('call_booked', NOW - 5 * H, { meeting_at: t1, appointment_id: 'A' }), ev('appointment_rescheduled', NOW - 4 * H, { meeting_at: t2 })], NOW).length, 1);
  assert.equal(activeBookings([ev('call_booked', NOW - 5 * H, { meeting_at: t1, appointment_id: 'A' }), ev('appointment_cancelled', NOW - 4 * H, { appointment_id: 'A' })], NOW).length, 0);
  assert.equal(activeBookings([ev('call_booked', NOW - 5 * H, { meeting_at: iso(NOW - H) }), ev('call_booked', NOW - 4 * H, { meeting_at: t2 })], NOW).length, 1);
});

test('facts: live meeting, resolved, owner, triage, history, last interaction', () => {
  const m = iso(NOW + 48 * H);
  const team = [{ id: 't1', jmeno: 'Stage', ghl_jmeno: 'Stage Erdman' }, { id: 't2', jmeno: 'Vlado' }];
  let f = facts({ events: [ev('call_booked', NOW - 2 * H, { meeting_at: m, obchodnik: 'stage erdman' })], team }, NOW);
  assert.equal(f.liveMeeting.toISOString(), m);
  assert.equal(f.meetingOwner, 'Stage');
  assert.equal(f.hasHistory, true);
  f = facts({ events: [ev('call_booked', NOW - 2 * H, { meeting_at: m, obchodnik: 'Stage Erdman' }), ev('reassigned', NOW - H, { obchodnik_id: 't2' })], team }, NOW);
  assert.equal(f.meetingOwner, 'Vlado');
  // a cancellation of another time doesn't kill the live meeting; of this one (or with no time) it does
  assert.ok(facts({ events: [ev('call_booked', NOW - 2 * H, { meeting_at: m }), ev('appointment_cancelled', NOW - H, { meeting_at: iso(NOW + 24 * H) })] }, NOW).liveMeeting);
  assert.equal(facts({ events: [ev('call_booked', NOW - 2 * H, { meeting_at: m }), ev('appointment_cancelled', NOW - H, {})] }, NOW).resolved, true);
  // show/no-show count only from 20 min before the meeting; won/lost always
  assert.equal(facts({ events: [ev('call_booked', NOW - 2 * H, { meeting_at: m }), ev('no_show', NOW - H)] }, NOW).resolved, false);
  const won = facts({ events: [ev('call_booked', NOW - 2 * H, { meeting_at: m }), ev('won', NOW - H)] }, NOW);
  assert.deepEqual([won.resolved, won.closed, won.liveMeeting], [true, true, null]);
  assert.equal(facts({ events: [ev('call_booked', NOW - 3 * H, { meeting_at: iso(NOW - 2 * H) }), ev('show', NOW - 2 * H)] }, NOW).hadMeeting, true);
  assert.equal(facts({ events: [ev('no_show', NOW - H)] }, NOW).hadMeeting, false);
  // the latest booking with an unparseable time = no meeting
  assert.equal(facts({ events: [ev('call_booked', NOW - 3 * H, { meeting_at: m }), ev('call_booked', NOW - H, { meeting_at: 'tbd' })] }, NOW).meeting, null);
  f = facts({ calls: [{ dovolano: true, zahajen_at: iso(NOW - H), vysledek: 'termin' }, { dovolano: false, zahajen_at: iso(NOW - 0.5 * H) }],
    contact: { created_at: iso(NOW - 99 * H), owner_id: 'o' } }, NOW);
  assert.deepEqual([f.triageDone, f.hasHistory, f.lastTouch, f.ownerId], [true, true, NOW - H, 'o']);
  assert.deepEqual([facts({}, NOW).hasHistory, facts({}, NOW).lastTouch], [false, null]);
});

test('hide: confirm today before 9:00 Prague, past or resolved meetings, closed contacts', () => {
  assert.equal(needsConfirm(new Date(Date.parse('2026-11-12T07:30:00Z')), Date.parse('2026-11-12T06:00:00Z')), false); // 8:30 today, asked at 7:00
  assert.equal(needsConfirm(new Date(Date.parse('2026-11-12T08:00:00Z')), Date.parse('2026-11-12T06:00:00Z')), true); // 9:00 today
  assert.equal(needsConfirm(new Date(Date.parse('2026-11-13T07:00:00Z')), Date.parse('2026-11-12T06:00:00Z')), true); // 8:00 tomorrow
  assert.equal(needsConfirm(new Date(Date.parse('2026-11-12T07:30:00Z')), NOW), false); // already past
  assert.equal(hidden(row({ kind: 'confirm' }, { meeting: new Date(NOW + 3 * H) }), me.id, NOW), false);
  assert.equal(hidden(row({ kind: 'confirm' }, { meeting: new Date(NOW - H) }), me.id, NOW), true);
  assert.equal(hidden(row({ kind: 'confirm' }, { meeting: new Date(NOW + 3 * H), resolved: true }), me.id, NOW), true);
  assert.equal(hidden(row({ kind: 'confirm' }, { closed: true }), me.id, NOW), true);
  assert.equal(hidden(row({ kind: 'confirm' }), me.id, NOW), false); // unknown time: rather show
  assert.equal(hidden(row({ kind: 'call' }, { meeting: new Date(NOW - H) }), me.id, NOW), false);
});

test('hide: campaign not running, irrelevant, pending deletion, locked by someone else < 20 min', () => {
  assert.equal(hidden(row({ kind: 'kampan', campaign: { stav: 'pauza' } }), me.id, NOW), true);
  assert.equal(hidden(row({ kind: 'kampan', campaign: null }), me.id, NOW), true);
  assert.equal(hidden(row({ kind: 'kampan', campaign: { stav: 'bezi' } }), me.id, NOW), false);
  assert.equal(hidden(row({ kind: 'kampan', created_by: 'reaktivace' }), me.id, NOW), false);
  assert.equal(hidden(row({}, { nerelevantni: true }), me.id, NOW), true);
  assert.equal(hidden(row({}, { pendingDeletion: true }), me.id, NOW), true);
  assert.equal(hidden(row({ locked_by: 'other', locked_at: iso(NOW - 10 * 60e3) }), me.id, NOW), true);
  assert.equal(hidden(row({ locked_by: 'other', locked_at: iso(NOW - 25 * 60e3) }), me.id, NOW), false);
  assert.equal(hidden(row({ locked_by: 'me', locked_at: iso(NOW - 60e3) }), me.id, NOW), false);
});

test('merge: one row per contact, confirm › splatka › other › kampan, then earliest due; qualify', () => {
  const pick = (rows) => merge(rows)[0];
  let w = pick([row({ contact_id: 'a', kind: 'call' }), row({ contact_id: 'a', kind: 'confirm' })]);
  assert.deepEqual([w.kind, w.merged, w.qualify], ['confirm', 1, true]);
  assert.equal(pick([row({ contact_id: 'a', kind: 'call', attempts: 2 }), row({ contact_id: 'a', kind: 'confirm' })]).qualify, false);
  assert.equal(pick([row({ contact_id: 'a', kind: 'followup' }), row({ contact_id: 'a', kind: 'splatka' })]).kind, 'splatka');
  assert.equal(pick([row({ contact_id: 'a', kind: 'kampan' }), row({ contact_id: 'a', kind: 'followup' })]).kind, 'followup');
  w = pick([row({ contact_id: 'a', due_at: iso(NOW - H) }), row({ contact_id: 'a', due_at: iso(NOW - 2 * H) })]);
  assert.equal(w.due_at, iso(NOW - 2 * H));
  assert.equal(w.qualify, false);
  assert.equal(merge([row({ contact_id: 'a' }), row({ contact_id: 'b' })]).length, 2);
});

test('classify: every group', () => {
  const live = new Date(NOW + 30 * H), today = new Date(NOW + 3 * H);
  assert.equal(group(row({}, { ownerId: 'other' })), 'LEADY KOLEGŮ');
  assert.equal(group(row({}, { multiBooking: true })), 'VÍC REZERVACÍ');
  assert.equal(group(row({}, { liveMeeting: live, meeting: live })), 'TRIÁŽ');
  assert.equal(group(row({ follow_typ: 'domluveny' })), 'DOMLUVENÝ FOLLOW-UP');
  assert.equal(group(row({ kind: 'followup' })), 'DOMLUVENÝ FOLLOW-UP');
  assert.deepEqual(classify(row({ kind: 'confirm' }, { liveMeeting: today, triageDone: true }), me.id, NOW), [950, 'POTVRZENÍ SCHŮZKY']);
  assert.deepEqual(classify(row({ kind: 'call', note: 'x triage ✓' }, { liveMeeting: live }), me.id, NOW), [900, 'POTVRZENÍ SCHŮZKY']);
  assert.equal(group(row({ kind: 'confirm' })), 'POTVRZENÍ SCHŮZKY');
  assert.equal(group(row()), 'NOVÝ LEAD');
  assert.equal(group(row({}, { hasHistory: true })), 'VRÁCÍ SE');
  assert.equal(group(row({ note: 'Nedorazil na free konzultaci' })), 'NO SHOW');
  assert.equal(group(row({ note: 'Zrušil konzultaci' }, { hasHistory: true })), 'NO SHOW');
  assert.equal(group(row({ follow_typ: 'konzultace' })), 'FOLLOWUP PO KONZULTACI');
  assert.equal(group(row({}, { hadMeeting: true, hasHistory: true })), 'FOLLOWUP PO KONZULTACI');
  assert.equal(group(row({ kind: 'splatka' }, { hadMeeting: true })), 'SPLÁTKY');
  assert.equal(group(row({ kind: 'kampan', created_by: 'reaktivace' })), 'REAKTIVACE');
  assert.equal(group(row({ kind: 'kampan', campaign: { nazev: 'Podzim', stav: 'bezi' } })), 'KAMPAŇ · Podzim');
  assert.equal(group(row({ attempts: 2 }, { hasHistory: true })), 'NEDOVOLANÉ');
  assert.deepEqual(['DOMLUVENÝ FOLLOW-UP', 'TRIÁŽ', 'NO SHOW'].map(colorOf), ['A', 'B', 'C']);
});

test('classify: check order, not display order, decides', () => {
  const live = new Date(NOW + 30 * H);
  assert.equal(group(row({ kind: 'confirm', follow_typ: 'domluveny' }, { ownerId: 'other', multiBooking: true, liveMeeting: live })), 'LEADY KOLEGŮ');
  assert.equal(group(row({ assigned_to: 'me' }, { ownerId: 'other' })), 'NOVÝ LEAD'); // assigned to me: not a colleague's
  assert.equal(group(row({}, { multiBooking: true, liveMeeting: live })), 'VÍC REZERVACÍ');
  assert.equal(group(row({ follow_typ: 'domluveny' }, { liveMeeting: live })), 'TRIÁŽ');
  assert.equal(group(row({ follow_typ: 'domluveny' }, { liveMeeting: live, triageDone: true })), 'DOMLUVENÝ FOLLOW-UP');
  assert.equal(group(row({ follow_typ: 'domluveny' }, { hadMeeting: true })), 'FOLLOWUP PO KONZULTACI'); // konzultace beats domluveny
  assert.equal(group(row({ kind: 'followup', follow_typ: 'konzultace' })), 'FOLLOWUP PO KONZULTACI');
  assert.equal(group(row({ note: 'Nedorazil' }, { hadMeeting: true, hasHistory: true })), 'NO SHOW'); // no-show beats after-consultation
  assert.equal(group(row({ kind: 'confirm' }, { liveMeeting: live, closed: true })), 'POTVRZENÍ SCHŮZKY'); // closed: no triage
  assert.equal(group(row({ follow_typ: 'domluveny' })), 'DOMLUVENÝ FOLLOW-UP'); // follow mark: not a new lead
});

test('call now: due or multiple bookings; my zones only when mine; kampan out', () => {
  const live = new Date(NOW + 30 * H);
  const rows = [
    row({ contact_id: 'later', due_at: iso(NOW + H) }),
    row({ contact_id: 'multi', due_at: iso(NOW + 99 * H), assigned_to: 'x' }, { multiBooking: true }),
    row({ contact_id: 'fuOther', follow_typ: 'domluveny', assigned_to: 'x' }),
    row({ contact_id: 'fuMine', follow_typ: 'domluveny' }, { ownerId: 'me' }),
    row({ contact_id: 'fuFree', kind: 'followup' }),
    row({ contact_id: 'konzOther', follow_typ: 'konzultace' }, { ownerId: 'x' }), // a colleague's, in a zone
    row({ contact_id: 'colNew' }, { ownerId: 'x' }), // a colleague's, outside the zones
    row({ contact_id: 'triOther' }, { liveMeeting: live, meetingOwner: 'Vlado' }),
    row({ contact_id: 'triMine', assigned_to: 'x' }, { liveMeeting: live, meetingOwner: 'Stage' }),
    row({ contact_id: 'triAnyone', assigned_to: 'x' }, { liveMeeting: live }),
    row({ contact_id: 'newOther', assigned_to: 'x' }),
    row({ contact_id: 'camp', kind: 'kampan', campaign: { stav: 'bezi', nazev: 'K' } }),
    row({ contact_id: 'locked', locked_by: 'x', locked_at: iso(NOW) }),
  ];
  const out = callNow(rows, me, NOW).map((x) => x.row.contact_id);
  assert.deepEqual(out, ['multi', 'triMine', 'triAnyone', 'fuMine', 'fuFree', 'newOther', 'colNew']);
});

test('sort: score, then soonest live meeting (meetings first), then newest interaction, falling back to due', () => {
  const m = (h) => new Date(NOW + h * H);
  const rows = [
    row({ contact_id: 'p48', kind: 'confirm' }, { liveMeeting: m(48), triageDone: true }),
    row({ contact_id: 'pNone', kind: 'confirm', due_at: iso(NOW - 2 * H) }),
    row({ contact_id: 'p30', kind: 'confirm' }, { liveMeeting: m(30), triageDone: true }),
    row({ contact_id: 'pToday', kind: 'confirm' }, { liveMeeting: m(3), triageDone: true }),
    row({ contact_id: 'nOld', attempts: 1 }, { hasHistory: true, lastTouch: NOW - 50 * H }),
    row({ contact_id: 'nDue', attempts: 1, due_at: iso(NOW - 10 * H) }, { hasHistory: true }),
    row({ contact_id: 'nNew', attempts: 1 }, { hasHistory: true, lastTouch: NOW - 5 * H }),
    row({ contact_id: 'lead' }, { lastTouch: NOW - H }),
    row({ contact_id: 'col' }, { ownerId: 'x' }),
  ];
  const out = callNow(rows, me, NOW);
  assert.deepEqual(out.map((x) => x.row.contact_id), ['pToday', 'p30', 'p48', 'pNone', 'lead', 'nNew', 'nDue', 'nOld', 'col']);
  assert.deepEqual(out.map((x) => x.score), [950, 900, 900, 900, 800, 700, 700, 700, 300]);
});

test('sort: same score sorts by group name, Czech collation', () => {
  const rows = [row({ contact_id: 'b', kind: 'kampan', campaign: { stav: 'bezi', nazev: 'Čas' } }), row({ contact_id: 'a', kind: 'kampan', campaign: { stav: 'bezi', nazev: 'Dno' } })];
  const sorted = merge(rows).map((r) => classify(r, me.id, NOW)[1]).sort((x, y) => x.localeCompare(y, 'cs'));
  assert.deepEqual(sorted, ['KAMPAŇ · Čas', 'KAMPAŇ · Dno']);
  assert.equal(callNow(rows, me, NOW).length, 0); // kampan rows are not in the main view
});
