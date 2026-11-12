// Fronta: ResultsON Cockpit's "Volat teď" list, replicated read-only (rules in
// updates/2026-11-12 CHAT - OPEN/fronta-rules.md, mirroring 19-Cockpit.js).
// Pure, no I/O. Never locks, closes merged tasks or self-heals: the merge is
// in memory only. "Today", "before 9:00" etc. are Prague time, whatever the Mac's.
const TZ = 'Europe/Prague';
const LOCK_MS = 20 * 60e3;
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const parts = (d) => Object.fromEntries(fmt.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, +p.value]));
const offsetMin = (d) => {
  const p = parts(d);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60e3);
};
// A Prague wall-clock time as a real instant (twice, for DST changes).
export function fromPrague(y, month0, day, h = 0, min = 0) {
  const guess = Date.UTC(y, month0, day, h, min);
  let t = guess - offsetMin(new Date(guess)) * 60e3;
  t = guess - offsetMin(new Date(t)) * 60e3;
  return new Date(t);
}
export const pragueDay = (d) => { const p = parts(new Date(d)); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
const pragueHour = (d) => parts(new Date(d)).hour % 24;

// meeting_at: GHL text ("October 21, 2026 3:00 PM") or ISO without a zone are
// Prague time; ISO with a zone is taken as is.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function parseMeeting(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (m && MONTHS.includes(m[1].toLowerCase())) return fromPrague(+m[3], MONTHS.indexOf(m[1].toLowerCase()), +m[2], (+m[4] % 12) + (/pm/i.test(m[6]) ? 12 : 0), +m[5]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2})?)?$/);
  if (m) return fromPrague(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

const BOOK = ['call_booked', 'appointment_rescheduled'];
const SHOW = ['show', 'show_no_offer', 'show_offer'];
const DONE = [...SHOW, 'no_show', 'won', 'lost'];
const at = (e) => Date.parse(e.occurred_at);
const newestFirst = (events) => [...events].sort((a, b) => at(b) - at(a) || (b.id ?? 0) - (a.id ?? 0));

// aktivniRezervace: future bookings that still stand. Same GHL appointment_id
// = one meeting (latest event wins; an app reschedule without an id belongs to
// the last known one), same minute = one meeting, cancelled ones drop out.
export function activeBookings(events, now = Date.now()) {
  const evs = [...events].sort((a, b) => at(a) - at(b) || (a.id ?? 0) - (b.id ?? 0));
  const validId = (x) => (x && String(x).trim() && !String(x).includes('{{') ? String(x).trim() : null);
  const minute = (t) => Math.round(t.getTime() / 60e3);
  const meetings = {}, cancelledMin = {}, cancelledId = {};
  let lastId = null;
  for (const e of evs) {
    const m = e.meta || {}, id = validId(m.appointment_id), t = parseMeeting(m.meeting_at);
    if (e.event === 'appointment_cancelled') {
      if (t) cancelledMin[minute(t)] = e.occurred_at;
      if (id) cancelledId[id] = e.occurred_at;
      continue;
    }
    if (!BOOK.includes(e.event) || !t) continue;
    const key = id || (e.event === 'appointment_rescheduled' && lastId) || `t${minute(t)}`;
    for (const k of Object.keys(meetings)) if (k !== key && k[0] === 't' && meetings[k].min === minute(t)) delete meetings[k];
    meetings[key] = { when: t, min: minute(t), at: e.occurred_at };
    if (id) lastId = id;
  }
  const seen = {}, out = [];
  for (const [k, s] of Object.entries(meetings).sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at))) {
    if (s.when.getTime() <= now) continue;
    if (cancelledMin[s.min] && Date.parse(cancelledMin[s.min]) >= Date.parse(s.at)) continue;
    if (k[0] !== 't' && cancelledId[k] && Date.parse(cancelledId[k]) >= Date.parse(s.at)) continue;
    if (seen[s.min]) continue;
    seen[s.min] = true;
    out.push(s.when);
  }
  return out.sort((a, b) => a - b);
}

// Section 2: facts about one contact from its funnel events (the Fronta list
// only), calls and contact row; team maps calendar names to members.
export function facts({ events = [], calls = [], contact = {}, team = [] } = {}, now = Date.now()) {
  const ev = newestFirst(events);
  const connected = calls.filter((c) => c.dovolano && c.zahajen_at).map((c) => Date.parse(c.zahajen_at));
  const last = Math.max(ev.length ? at(ev[0]) : 0, contact.created_at ? Date.parse(contact.created_at) : 0, ...connected);
  const f = {
    ownerId: contact.owner_id || null,
    closed: ev.some((e) => e.event === 'won' || e.event === 'lost'),
    hadMeeting: ev.some((e) => SHOW.includes(e.event)),
    hasHistory: calls.length > 0 || ev.length > 0,
    triageDone: calls.some((c) => c.vysledek === 'triage' || c.vysledek === 'termin'),
    lastTouch: last > 0 ? last : null,
    multiBooking: activeBookings(ev, now).length > 1,
    meeting: null, resolved: false, meetingOwner: null, liveMeeting: null,
  };
  // The meeting is the latest booking; unparseable time = no meeting (as the Cockpit does).
  const booking = ev.find((e) => BOOK.includes(e.event));
  const m = booking && parseMeeting(booking.meta?.meeting_at);
  if (!m) return f;
  const bt = at(booking), mt = m.getTime();
  const cancelled = ev.some((e) => {
    if (e.event !== 'appointment_cancelled' || at(e) < bt) return false;
    const cm = parseMeeting(e.meta?.meeting_at);
    return !cm || Math.abs(cm.getTime() - mt) < 60e3;
  });
  const done = ev.some((e) => DONE.includes(e.event) && at(e) >= bt && (e.event === 'won' || e.event === 'lost' || at(e) >= mt - 20 * 60e3))
    || ev.some((e) => (e.event === 'won' || e.event === 'lost') && at(e) >= mt - 20 * 60e3);
  const byName = (s) => {
    const q = String(s).trim().toLowerCase();
    const t = team.find((x) => (x.ghl_jmeno || '').trim().toLowerCase() === q || (x.jmeno || '').trim().toLowerCase() === q)
      || team.find((x) => q && (x.jmeno || '').toLowerCase().includes(q.split(' ')[0]));
    return t ? t.jmeno : String(s);
  };
  const re = ev.find((e) => e.event === 'reassigned' && at(e) >= bt);
  let owner = null;
  if (re?.meta?.obchodnik_id) owner = team.find((x) => x.id === re.meta.obchodnik_id)?.jmeno || re.meta.obchodnik || null;
  if (!owner && booking.meta?.obchodnik) owner = byName(booking.meta.obchodnik);
  Object.assign(f, { meeting: m, resolved: cancelled || done, meetingOwner: owner });
  f.liveMeeting = !f.resolved && mt > now ? m : null;
  return f;
}

// Confirming makes no sense for a past meeting, or one today before 9:00 (handled in person).
export const needsConfirm = (meeting, now = Date.now()) =>
  !(meeting.getTime() < now || (pragueDay(meeting) === pragueDay(now) && pragueHour(meeting) < 9));

// A row = a v_queue row plus the task's follow_typ / created_by / locked_*,
// its campaign ({ stav, nazev } | null), and ctx = facts() + pendingDeletion, nerelevantni.
const reakt = (r) => r.kind === 'kampan' && r.created_by === 'reaktivace';

// 3.1
export function hidden(r, meId, now = Date.now()) {
  const c = r.ctx;
  return (r.kind === 'confirm' && (c.resolved || c.closed || (c.meeting && !needsConfirm(c.meeting, now))))
    || (r.kind === 'kampan' && !reakt(r) && r.campaign?.stav !== 'bezi')
    || !!c.pendingDeletion || !!c.nerelevantni
    || (!!r.locked_by && r.locked_by !== meId && now - Date.parse(r.locked_at || 0) < LOCK_MS);
}

// 3.2: one row per contact; confirm › splatka › other › kampan, then earliest due.
// qualify: a confirm that absorbed a never-attempted ordinary task.
const prio = (r) => (r.kind === 'confirm' ? 3 : r.kind === 'splatka' ? 2 : r.kind === 'kampan' ? 0 : 1);
export function merge(rows) {
  const by = new Map();
  for (const r of rows) by.set(r.contact_id, [...(by.get(r.contact_id) || []), r]);
  return [...by.values()].map((list) => {
    const [win, ...rest] = [...list].sort((a, b) => prio(b) - prio(a) || Date.parse(a.due_at || 0) - Date.parse(b.due_at || 0));
    return { ...win, merged: rest.length, qualify: win.kind === 'confirm' && rest.some((x) => prio(x) === 1 && !(x.attempts > 0)) };
  });
}

// 3.3: the first matching check wins (not the display order).
const noShow = (r) => r.kind === 'call' && /Nedorazil|Zrušil/i.test(r.note || '');
const followKonz = (r) => !['confirm', 'splatka', 'kampan'].includes(r.kind)
  && (r.follow_typ === 'konzultace' || (r.ctx.hadMeeting && !/Nedorazil/i.test(r.note || '')));
const agreedFU = (r) => !followKonz(r) && (r.follow_typ === 'domluveny' || r.kind === 'followup');
const hasMeeting = (r) => r.kind === 'confirm' || !!r.ctx.liveMeeting;
const triage = (r) => hasMeeting(r) && !!r.ctx.liveMeeting && !r.ctx.closed && !/triage ✓/.test(r.note || '') && !r.ctx.triageDone;
const isNew = (r) => r.kind === 'call' && !r.attempts && !noShow(r) && !r.ctx.hasHistory && !r.follow_typ;
const colleague = (r, meId) => !!r.ctx.ownerId && r.ctx.ownerId !== meId && r.assigned_to !== meId;

export function classify(r, meId, now = Date.now()) {
  const c = r.ctx;
  if (colleague(r, meId)) return [300, 'LEADY KOLEGŮ'];
  if (c.multiBooking) return [1000, 'VÍC REZERVACÍ'];
  if (triage(r)) return [970, 'TRIÁŽ'];
  if (agreedFU(r)) return [960, 'DOMLUVENÝ FOLLOW-UP'];
  if (hasMeeting(r)) return [c.liveMeeting && pragueDay(c.liveMeeting) === pragueDay(now) ? 950 : 900, 'POTVRZENÍ SCHŮZKY'];
  if (isNew(r)) return [800, 'NOVÝ LEAD'];
  if (noShow(r)) return [790, 'NO SHOW'];
  if (followKonz(r)) return [780, 'FOLLOWUP PO KONZULTACI'];
  if (r.kind === 'splatka') return [750, 'SPLÁTKY'];
  if (reakt(r)) return [420, 'REAKTIVACE'];
  if (r.kind === 'kampan') return [400, `KAMPAŇ · ${r.campaign?.nazev || 'navolávání'}`];
  if (!r.attempts) return [760, 'VRÁCÍ SE'];
  return [700, 'NEDOVOLANÉ'];
}

const COLOR = { 'DOMLUVENÝ FOLLOW-UP': 'A', 'VÍC REZERVACÍ': 'B', 'TRIÁŽ': 'B', 'POTVRZENÍ SCHŮZKY': 'B', 'NOVÝ LEAD': 'B', 'SPLÁTKY': 'B' };
export const colorOf = (group) => COLOR[group] || 'C';

// 3.4 + 3.5 + 3.6: the main "call now" list (no kampan rows), sorted, as
// [{ row, score, group, color }]. me = { id, jmeno }.
export function callNow(rows, me, now = Date.now()) {
  const myZone = (r) => triage(r) || followKonz(r) || agreedFU(r);
  const mine = (r) => (triage(r)
    ? (r.ctx.meetingOwner ? r.ctx.meetingOwner === me.jmeno : true)
    : r.assigned_to === me.id || r.ctx.ownerId === me.id || (!r.ctx.ownerId && !r.assigned_to));
  const due = (r) => Date.parse(r.due_at) <= now;
  const touch = (r) => r.ctx.lastTouch || Date.parse(r.due_at || 0);
  return merge(rows.filter((r) => !hidden(r, me.id, now)))
    .filter((r) => (due(r) || r.ctx.multiBooking) && (r.ctx.multiBooking || !myZone(r) || mine(r)))
    .map((row) => { const [score, group] = classify(row, me.id, now); return { row, score, group, color: colorOf(group) }; })
    .sort((a, b) => b.score - a.score || a.group.localeCompare(b.group, 'cs')
      || cmpMeeting(a.row.ctx.liveMeeting, b.row.ctx.liveMeeting) || touch(b.row) - touch(a.row))
    .filter((x) => x.row.kind !== 'kampan');
}
// Future meeting first, soonest first; rows without one after.
const cmpMeeting = (a, b) => (a && b ? a - b : a ? -1 : b ? 1 : 0);
