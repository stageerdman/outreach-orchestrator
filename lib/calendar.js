// Google Calendar, read-only, through each calendar's secret iCal address
// (GOOGLE_CALENDAR_ICS, several separated by spaces). Only busy times are
// used: the AI sees free windows, never event titles. Recurring events are
// expanded (DAILY / WEEKLY / MONTHLY / YEARLY with INTERVAL, COUNT, UNTIL,
// BYDAY, BYMONTHDAY, BYMONTH, EXDATE and moved/cancelled single occurrences).
const TZ = 'Europe/Prague';
const QUARTER = 15 * 60e3, DAY = 864e5, TTL = 5 * 60e3, DAYS = 14, MIN_SLOT = 30 * 60e3;
const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const urls = () => (process.env.GOOGLE_CALENDAR_ICS || '').split(/[\s,]+/).filter((u) => /^https?:\/\//.test(u));
export const calendarConfigured = () => urls().length > 0;
// Working hours (Prague), CALENDAR_HOURS="9-18", Monday to Friday.
export function workHours(s = process.env.CALENDAR_HOURS) {
  const m = /^(\d{1,2})(?::(\d\d))?-(\d{1,2})(?::(\d\d))?$/.exec((s || '').trim());
  return m ? [+m[1] * 60 + +(m[2] || 0), +m[3] * 60 + +(m[4] || 0)] : [9 * 60, 18 * 60];
}

// --- time zones: wall clock in a zone <-> UTC ---
const fmts = new Map();
function offset(ms, tz) {
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  const p = Object.fromEntries(fmts.get(tz).formatToParts(ms).map((x) => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
// wall: ms as if the zone were UTC.
export function zoned(wall, tz = TZ) {
  let t = wall - offset(wall, tz);
  return wall - offset(t, tz);
}
const toWall = (ms, tz = TZ) => ms + offset(ms, tz);
const validTz = (tz) => { try { offset(0, tz); return tz; } catch { return TZ; } };

// --- parsing ---
function value(prop) {
  const v = prop.value, tz = validTz(prop.params.TZID || TZ);
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?$/.exec(v.trim());
  if (!m) return null;
  const wall = Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const allDay = !m[4];
  return { wall: m[7] ? toWall(wall, tz) : wall, tz, allDay, utc: !!m[7] };
}
const real = (v) => zoned(v.wall, v.tz);

export function parseIcs(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (ev?.start) out.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...ps] = line.slice(0, i).split(';');
    const prop = { value: line.slice(i + 1), params: Object.fromEntries(ps.map((p) => p.split('='))) };
    switch (name.toUpperCase()) {
      case 'UID': ev.uid = prop.value; break;
      case 'DTSTART': ev.start = value(prop); break;
      case 'DTEND': ev.end = value(prop); break;
      case 'DURATION': ev.duration = duration(prop.value); break;
      case 'RRULE': ev.rrule = Object.fromEntries(prop.value.split(';').map((p) => p.split('='))); break;
      case 'EXDATE': ev.exdates.push(...prop.value.split(',').map((x) => value({ ...prop, value: x })).filter(Boolean).map(real)); break;
      case 'RECURRENCE-ID': ev.recurrenceId = value(prop); break;
      case 'STATUS': ev.cancelled = prop.value === 'CANCELLED'; break;
      case 'TRANSP': ev.free = prop.value === 'TRANSPARENT'; break;
    }
  }
  return out;
}
function duration(s) {
  const m = /^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s.trim());
  return m ? ((+(m[1] || 0) * 7 + +(m[2] || 0)) * 24 * 3600 + +(m[3] || 0) * 3600 + +(m[4] || 0) * 60 + +(m[5] || 0)) * 1000 : 0;
}

// --- recurrence: occurrence starts as wall clock times in the event's zone ---
function* wallStarts(start, r) {
  const freq = r.FREQ, step = +(r.INTERVAL || 1);
  const d0 = new Date(start.wall), tod = start.wall % DAY;
  const days = r.BYDAY ? r.BYDAY.split(',').map((x) => ({ n: +(x.slice(0, -2) || 0), wd: WD.indexOf(x.slice(-2)) })) : null;
  const months = r.BYMONTH ? r.BYMONTH.split(',').map((x) => +x - 1) : null;
  const mdays = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
  // Days of one month that match BYDAY (with nth) / BYMONTHDAY, else the start's day.
  const inMonth = (y, mo) => {
    const len = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(), list = [];
    for (let d = 1; d <= len; d++) {
      const wd = new Date(Date.UTC(y, mo, d)).getUTCDay();
      const ok = mdays ? mdays.some((x) => x === d || len + x + 1 === d)
        : days ? days.some((x) => x.wd === wd && (!x.n || x.n === Math.ceil(d / 7) || (x.n < 0 && Math.ceil((len - d + 1) / 7) === -x.n)))
        : d === d0.getUTCDate();
      if (ok) list.push(Date.UTC(y, mo, d) + tod);
    }
    return list;
  };
  if (freq === 'DAILY') for (let t = start.wall; ; t += step * DAY) yield t;
  else if (freq === 'WEEKLY') {
    const wds = days ? days.map((x) => x.wd) : [d0.getUTCDay()];
    const wkst = WD.indexOf(r.WKST || 'MO');
    const weekStart = start.wall - tod - ((d0.getUTCDay() - wkst + 7) % 7) * DAY;
    for (let w = weekStart; ; w += step * 7 * DAY)
      for (let i = 0; i < 7; i++) if (wds.includes(new Date(w + i * DAY).getUTCDay())) yield w + i * DAY + tod;
  } else if (freq === 'MONTHLY') {
    for (let k = 0; ; k += step) {
      const y = d0.getUTCFullYear() + Math.floor((d0.getUTCMonth() + k) / 12), mo = (d0.getUTCMonth() + k) % 12;
      yield* inMonth(y, mo);
    }
  } else if (freq === 'YEARLY') {
    for (let y = d0.getUTCFullYear(); ; y += step)
      for (const mo of months || [d0.getUTCMonth()])
        yield* (days || mdays ? inMonth(y, mo) : [Date.UTC(y, mo, d0.getUTCDate()) + tod].filter((t) => new Date(t).getUTCMonth() === mo));
  } else yield start.wall;
}

// Busy intervals [start, end] (ms) overlapping [from, to], merged and sorted.
export function busyBetween(events, from, to, merge = true) {
  const moved = new Map();
  for (const e of events) if (e.recurrenceId) moved.set(`${e.uid}|${real(e.recurrenceId)}`, e);
  const out = [];
  const add = (e, s, len) => { if (!e.cancelled && !e.free && s < to && s + len > from) out.push([s, s + len]); };
  for (const e of events) {
    const s0 = real(e.start);
    const len = e.end ? real(e.end) - s0 : e.duration || (e.start.allDay ? DAY : 0);
    if (e.recurrenceId || !e.rrule) { add(e, s0, len); continue; }
    const until = e.rrule.UNTIL ? real(value({ value: e.rrule.UNTIL, params: { TZID: e.start.tz } })) : Infinity;
    const count = e.rrule.COUNT ? +e.rrule.COUNT : Infinity;
    let n = 0;
    for (const w of wallStarts(e.start, e.rrule)) {
      if (w < e.start.wall) continue;
      const s = zoned(w, e.start.tz);
      if (s > until || n >= count || s >= to) break;
      n++;
      if (s + len <= from || e.exdates.includes(s) || moved.has(`${e.uid}|${s}`)) continue;
      add(e, s, len);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  if (!merge) return out;
  const merged = [];
  for (const b of out) {
    const last = merged.at(-1);
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push([...b]);
  }
  return merged;
}

// Free windows per working day (Prague), from now on, at least 30 minutes.
export function freeDays(busy, now = Date.now(), days = DAYS, hours = workHours()) {
  const out = [], today = Math.floor(toWall(now) / DAY) * DAY;
  for (let i = 0; i < days; i++) {
    const day = today + i * DAY, wd = new Date(day).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    let s = Math.max(zoned(day + hours[0] * 60e3), Math.ceil(now / QUARTER) * QUARTER);
    const end = zoned(day + hours[1] * 60e3), free = [];
    for (const [bs, be] of busy) {
      if (be <= s || bs >= end) continue;
      if (bs - s >= MIN_SLOT) free.push([s, bs]);
      s = Math.max(s, be);
    }
    if (end - s >= MIN_SLOT) free.push([s, end]);
    if (s < end || free.length || i > 0) out.push({ day, free });
  }
  return out;
}

const hm = (ms) => new Date(ms).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
export function renderFree(days) {
  return days.map(({ day, free }) => {
    const d = new Date(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
    return `${d}: ${free.length ? free.map(([s, e]) => `${hm(s)}–${hm(e)}`).join(', ') : 'fully booked'}`;
  }).join('\n');
}

// --- fetching, cached for 5 minutes ---
let last = { at: 0, events: null, error: null, calendars: 0 }, pending = null;
async function load() {
  const list = urls();
  const texts = await Promise.all(list.map(async (u, i) => {
    const r = await fetch(u, { signal: AbortSignal.timeout(15e3) });
    if (!r.ok) throw new Error(`Calendar ${i + 1} answered ${r.status}`);
    return r.text();
  }));
  return { at: Date.now(), events: texts.flatMap(parseIcs), error: null, calendars: list.length };
}
export function calendarEvents() {
  if (last.events && Date.now() - last.at < TTL) return Promise.resolve(last.events);
  pending ??= load().then((x) => (last = x).events, (e) => { last = { ...last, at: Date.now(), error: e.message }; throw e; })
    .finally(() => { pending = null; });
  return pending;
}

// The text the drafting AI gets, or '' when not set up / unreachable.
export async function availabilityText(now = Date.now()) {
  if (!calendarConfigured()) return '';
  try {
    const events = await calendarEvents();
    return renderFree(freeDays(busyBetween(events, now, now + DAYS * DAY), now));
  } catch { return ''; }
}

// For the Connections diagram (sync): the last fetch, refreshing in the background.
export function calendarStatus(now = Date.now()) {
  if (!calendarConfigured()) return { state: 'off', detail: 'Not set up' };
  if (!pending && Date.now() - last.at >= TTL) calendarEvents().catch(() => {});
  if (last.error && !last.events) return { state: 'error', detail: last.error };
  if (!last.events) return { state: 'live', detail: 'Connecting…' };
  const n = busyBetween(last.events, now, now + 7 * DAY, false).length;
  return { state: last.error ? 'error' : 'live', detail: last.error || `${n} ${n === 1 ? 'event' : 'events'} this week` };
}
