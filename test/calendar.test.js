import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, busyBetween, freeDays, renderFree, zoned, workHours } from '../lib/calendar.js';

const ics = (...evs) => ['BEGIN:VCALENDAR', ...evs.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const at = (s) => new Date(s).getTime();
const f = (x) => new Date(x).toISOString();

test('Prague wall clock to UTC across DST', () => {
  assert.equal(f(zoned(Date.UTC(2026, 6, 1, 10))), '2026-07-01T08:00:00.000Z');
  assert.equal(f(zoned(Date.UTC(2026, 11, 1, 10))), '2026-12-01T09:00:00.000Z');
});

test('single, UTC, all-day, free and cancelled events', () => {
  const ev = parseIcs(ics(
    ['UID:a', 'DTSTART;TZID=Europe/Prague:20261116T100000', 'DTEND;TZID=Europe/Prague:20261116T110000'],
    ['UID:b', 'DTSTART:20261116T130000Z', 'DTEND:20261116T133000Z', 'SUMMARY:x:y'],
    ['UID:c', 'DTSTART;VALUE=DATE:20261117', 'DTEND;VALUE=DATE:20261118', 'TRANSP:TRANSPARENT'],
    ['UID:d', 'DTSTART:20261116T150000Z', 'DTEND:20261116T160000Z', 'STATUS:CANCELLED'],
  ));
  const b = busyBetween(ev, at('2026-11-16T00:00Z'), at('2026-11-18T00:00Z')).map(([s, e]) => [f(s), f(e)]);
  assert.deepEqual(b, [['2026-11-16T09:00:00.000Z', '2026-11-16T10:00:00.000Z'], ['2026-11-16T13:00:00.000Z', '2026-11-16T13:30:00.000Z']]);
});

test('weekly recurrence keeps local time over DST, with EXDATE, moved occurrence and UNTIL', () => {
  const ev = parseIcs(ics(
    ['UID:w', 'DTSTART;TZID=Europe/Prague:20261019T090000', 'DTEND;TZID=Europe/Prague:20261019T093000',
      'RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20261124T225959Z;BYDAY=MO,WE', 'EXDATE;TZID=Europe/Prague:20261104T090000'],
    ['UID:w', 'RECURRENCE-ID;TZID=Europe/Prague:20261109T090000', 'DTSTART;TZID=Europe/Prague:20261109T140000', 'DTEND;TZID=Europe/Prague:20261109T150000'],
  ));
  const b = busyBetween(ev, at('2026-10-20T00:00Z'), at('2026-12-31T00:00Z')).map(([s]) => f(s));
  assert.deepEqual(b, ['2026-10-21T07:00:00.000Z', '2026-10-26T08:00:00.000Z', '2026-10-28T08:00:00.000Z', '2026-11-02T08:00:00.000Z',
    '2026-11-09T13:00:00.000Z', '2026-11-11T08:00:00.000Z', '2026-11-16T08:00:00.000Z', '2026-11-18T08:00:00.000Z', '2026-11-23T08:00:00.000Z']);
});

test('daily COUNT/INTERVAL, monthly nth weekday, yearly', () => {
  const ev = parseIcs(ics(
    ['UID:d', 'DTSTART:20261101T120000Z', 'DTEND:20261101T121500Z', 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3'],
    ['UID:m', 'DTSTART:20261110T060000Z', 'DURATION:PT1H', 'RRULE:FREQ=MONTHLY;BYDAY=2TU'],
    ['UID:y', 'DTSTART;VALUE=DATE:20251225', 'DTEND;VALUE=DATE:20251226', 'RRULE:FREQ=YEARLY'],
  ));
  const b = busyBetween(ev, at('2026-11-01T00:00Z'), at('2027-01-01T00:00Z')).map(([s]) => f(s));
  assert.deepEqual(b, ['2026-11-01T12:00:00.000Z', '2026-11-03T12:00:00.000Z', '2026-11-05T12:00:00.000Z',
    '2026-11-10T06:00:00.000Z', '2026-12-08T06:00:00.000Z', '2026-12-24T23:00:00.000Z']);
});

test('free windows: working days only, from now, 30 min minimum', () => {
  const busy = [[at('2026-11-13T09:00Z'), at('2026-11-13T09:45Z')], [at('2026-11-13T10:00Z'), at('2026-11-13T15:00Z')]];
  const days = freeDays(busy, at('2026-11-13T08:00Z'), 4, workHours('9-18'));
  assert.equal(renderFree(days), 'Fri 13/11: 09:00–10:00, 16:00–18:00\nMon 16/11: 09:00–18:00');
  assert.deepEqual(workHours('8:30-17'), [510, 1020]);
  assert.deepEqual(workHours(''), [540, 1080]);
});

test('meetings with a client: by attendee email or full name, with the Meet link; others stay out', async () => {
  const ev = parseIcs(ics(
    ['UID:m1', 'DTSTART:20261117T130000Z', 'DTEND:20261117T140000Z', 'SUMMARY:Konzultace\\, online',
      'ATTENDEE;CN=Someone;PARTSTAT=ACCEPTED:mailto:Jana@X.cz', 'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij'],
    ['UID:m2', 'DTSTART:20261110T090000Z', 'DTEND:20261110T093000Z', 'SUMMARY:Call s Jana Nováková',
      'DESCRIPTION:Join: https://meet.google.com/old-link-xyz\\nmore'],
    ['UID:m3', 'DTSTART:20261118T090000Z', 'DTEND:20261118T100000Z', 'SUMMARY:Dentist'],
    ['UID:m4', 'DTSTART:20261119T090000Z', 'DTEND:20261119T100000Z', 'SUMMARY:Jana', 'STATUS:CANCELLED', 'ATTENDEE:mailto:jana@x.cz'],
  ));
  const { clientMeetings, renderMeetings } = await import('../lib/calendar.js');
  const now = at('2026-11-16T12:00Z');
  const m = clientMeetings(ev, { name: 'Jana Novakova', emails: ['jana@x.cz'] }, now);
  assert.deepEqual(m.map((o) => o.event.uid), ['m2', 'm1']);
  const text = renderMeetings(m, now);
  assert.match(text, /2026-11-10 10:00 \(Tue\)–10:30 \(past\): Call s Jana Nováková · Google Meet: https:\/\/meet.google.com\/old-link-xyz/);
  assert.match(text, /2026-11-17 14:00 \(Tue\)–15:00: Konzultace, online · Google Meet: https:\/\/meet.google.com\/abc-defg-hij/);
  assert.equal(clientMeetings(ev, { name: 'Jana', emails: [] }, now).length, 0, 'a first name alone matches nothing');
});
