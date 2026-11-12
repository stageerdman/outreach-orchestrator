// ResultsON CRM (Supabase/PostgREST), read-only: every contact as a person
// with a pipeline stage, plus Fronta's call-now place for the queue rows.
// Reads whole tables in parallel; the login token is reused while valid (1 h).
import { facts, callNow, relabel } from './fronta.js';
const env = process.env;
export const resultsonConfigured = () => Boolean(env.RESULTSON_URL);

// The user's categories (2026-11-12), top (furthest along) first: the only
// stage names the UI, the AI and the playbooks see.
export const STAGES = ['Installments', 'Thinking about it', 'No show', 'To be booked', 'Not answered', 'New lead'];
// The former, finer stages, as the categories they fold into (older drafts,
// lessons and playbooks still name them).
export const LEGACY = {
  Installment: 'Installments', 'Waiting for Payment': 'Thinking about it', 'No Show': 'No show',
  'Meeting Confirmed': 'To be booked', 'Meeting Booked': 'To be booked', Answered: 'To be booked',
};
export const category = (label) => (STAGES.includes(label) ? label : LEGACY[label] ?? null);
const stage = (label) => ({ rank: STAGES.indexOf(label) + 1, label });
// Someone in Fronta's call-now list takes the category of their Fronta group
// when that group is one (To be booked, Thinking about it, Not answered,
// Installments, NO SHOW). Not NOVÝ LEAD: Fronta puts any call task without
// calls there (notes and returning clients too), so the history decides. A
// client paying installments stays Installments whatever the group.
export function categoryOf(group, history) {
  const g = group === 'NO SHOW' ? 'No show' : STAGES.includes(group) ? group : null;
  return g && history.label !== 'Installments' ? stage(g) : history;
}

// Sold, waiting for payment: a note says "Prodáno" (not "Neprodáno"), or the
// CRM's "Domluveno — čeká se na platbu" (agreed, waiting for the payment).
export const isSoldNote = (text) => /(?<!\p{L})prod[aá]no(?!\p{L})|čeká se na platbu/iu.test(text || '');

// The consultation happened without a sale: "Neprodáno" / "Bez nabídky" /
// "Konzultace bez nabídky" notes, or a task closed as "(show_offer)" / "(show_no_offer)".
export const isConsultedNote = (text) =>
  /^\s*(neprodáno|neprodano|bez nabídky|konzultace bez nabídky)(?!\p{L})|\(show_(no_)?offer\)/iu.test(text || '');
// The client didn't come: "Nedorazil (no-show)" notes, "Nedorazil na free
// konzultaci" in a task note, or a task closed as "(no_show)".
// Marked lost: undoes an earlier "waiting for payment".
export const isLostNote = (text) => /^\s*uzavřeno jako ztracené/iu.test(text || '');
export const isNoShowNote = (text) => /nedorazil|\(no_show\)/iu.test(text || '');
// A meeting is booked: "Domluvená schůzka", "klient má domluvenou schůzku",
// or "rezervoval si sám" (booked it himself).
export const isBookedNote = (text) => /domluven[áaéeouý]+ schůzk|rezervoval[a]? si sám/iu.test(text || '');
// Sold on installments: "Prodej na splátky" or "Upraveny platby" notes.
export const isInstallmentNote = (text) => /prodej na splátky|upraveny platby/iu.test(text || '');

// The category from the person's history: Installments, Thinking about it
// (consultation happened, also sold and waiting for the payment), No show,
// To be booked (answered, a meeting booked or confirmed), Not answered, New lead.
// Installment is the person's stage, not the task's: an installment task
// (open or closed) or an installment-sale note keeps them there.
// Specific signals first (installment, sold, consultation happened, no-show),
// then the furthest call result ever reached, so a later missed call doesn't
// move anyone back. A consultation that happened outranks an earlier no-show.
export function stageOf(task, results, { installment = false, sold = false, consulted = false, noShow = false, booked = false } = {}) {
  const rule = (task?.rule || '').toLowerCase();
  const has = (r) => results.includes(r);
  return stage(
    task?.kind === 'splatka' || installment ? 'Installments'
    : sold || task?.followType === 'konzultace' || consulted || has('neprodej') ? 'Thinking about it'
    : rule.includes('zrušení konzultace') || noShow ? 'No show'
    : booked || rule.includes('termín domluven') || results.some((r) => r !== 'nedovolano') ? 'To be booked'
    : results.length ? 'Not answered'
    : 'New lead');
}

// Every contact (except irrelevant ones and pending deletions) as a person.
// queue = their place in Fronta's main call-now list, else null; task = that
// row's task, or their soonest open task. d = the tables (see resultsonPeople).
export function toPeople(d, now = Date.now()) {
  const group = (rows, key = 'contact_id') => { const m = new Map(); for (const r of rows) m.set(r[key], [...(m.get(r[key]) || []), r]); return m; };
  const tasksById = new Map(d.tasks.map((t) => [t.id, t]));
  const callsBy = group(d.calls), eventsBy = group(d.events), openBy = group(d.queue);
  const pending = new Set(d.deletions.map((x) => x.contact_id));
  const contacts = new Map(d.contacts.map((c) => [c.id, c]));

  // Stage signals: call results, notes, all tasks (closed ones too).
  const results = {}, flags = {};
  const flag = (id, text) => {
    const f = (flags[id] ??= {});
    f.installment ||= isInstallmentNote(text); f.sold ||= isSoldNote(text); f.consulted ||= isConsultedNote(text);
    f.noShow ||= isNoShowNote(text); f.booked ||= isBookedNote(text);
  };
  for (const c of d.calls) { if (c.vysledek) (results[c.contact_id] ??= []).push(c.vysledek); flag(c.contact_id, c.poznamka); }
  for (const t of d.tasks) { flag(t.contact_id, t.note); if (t.kind === 'splatka') flags[t.contact_id].installment = true; }
  // Notes oldest first, so a later "lost" cancels an earlier sale.
  for (const n of [...d.notes].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))) {
    if (isLostNote(n.text)) Object.assign((flags[n.contact_id] ??= {}), { sold: false, installment: false });
    else flag(n.contact_id, n.text);
  }
  // Fully paid: no longer paying installments.
  for (const c of d.contacts) if (c.paid && flags[c.id]) flags[c.id].installment = false;

  // Fronta rows: v_queue + task columns + campaign + contact facts.
  const ctx = new Map();
  const ctxOf = (id) => ctx.get(id) ?? ctx.set(id, {
    ...facts({ events: eventsBy.get(id), calls: callsBy.get(id), contact: contacts.get(id), team: d.team }, now),
    pendingDeletion: pending.has(id), nerelevantni: !!contacts.get(id)?.nerelevantni,
  }).get(id);
  const rows = d.queue.map((q) => {
    const t = tasksById.get(q.task_id) || {};
    const k = /#K(\d+)/.exec(q.note || '');
    return { ...q, follow_typ: t.follow_typ ?? null, created_by: t.created_by ?? null, locked_by: t.locked_by ?? null, locked_at: t.locked_at ?? null,
      campaign: k ? d.campaigns.find((c) => String(c.id) === k[1]) || null : null, ctx: ctxOf(q.contact_id) };
  });
  const queue = new Map(relabel(callNow(rows, d.me, now)).map((x, i) => [x.row.contact_id, { ...x, order: i + 1 }]));

  const toTask = (t) => ({ id: t.task_id, unassigned: t.assigned_to == null, kind: t.kind, rule: t.rule_name || '',
    followType: tasksById.get(t.task_id)?.follow_typ || '', dueAt: t.due_at, note: t.note || '' });
  const people = [];
  for (const c of d.contacts) {
    if (c.nerelevantni || pending.has(c.id)) continue;
    const q = queue.get(c.id);
    const open = [...(openBy.get(c.id) || [])].sort((a, b) => a.due_at.localeCompare(b.due_at));
    const t = q?.row || open[0];
    const task = t ? toTask(t) : null;
    people.push({
      id: c.id,
      name: c.name || open[0]?.name || c.email || 'Unknown',
      company: c.funnel || '',
      emails: [c.email].filter(Boolean).map((e) => e.trim().toLowerCase()),
      phones: [c.phone_e164 || c.phone].filter(Boolean),
      ownerId: c.owner_id || null,
      stage: categoryOf(q?.group, stageOf(task, results[c.id] || [], flags[c.id])),
      task,
      queue: q ? { group: q.group, score: q.score, color: q.color, order: q.order,
        meetingAt: q.row.ctx.liveMeeting?.toISOString() ?? null, due: true, qualify: q.row.qualify } : null,
    });
  }
  return people;
}

// Login once per hour (the token's life), not on every refresh.
let session = null;
async function login(base) {
  if (session && session.expiresAt - 60e3 > Date.now()) return session;
  const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.RESULTSON_APIKEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.RESULTSON_EMAIL, password: env.RESULTSON_PASSWORD }),
  });
  const auth = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`CRM login failed: ${auth.error_description || auth.msg || res.status}`);
  return (session = { token: auth.access_token, userId: auth.user.id, expiresAt: Date.now() + (auth.expires_in ?? 3600) * 1e3 });
}

const PAGE = 1000; // PostgREST's max rows per response
const EVENTS = 'call_booked,appointment_rescheduled,appointment_cancelled,reassigned,show,show_no_offer,show_offer,no_show,won,lost';
const TABLES = {
  queue: 'v_queue?select=task_id,contact_id,assigned_to,name,kind,rule_name,due_at,attempts,note&order=task_id.asc',
  tasks: 'tasks?select=id,contact_id,kind,status,note,follow_typ,created_by,created_at,locked_by,locked_at&order=id.asc',
  contacts: 'contacts?select=id,name,email,phone,phone_e164,funnel,paid,owner_id,nerelevantni,created_at&order=id.asc',
  calls: 'hovory?select=id,contact_id,dovolano,zahajen_at,vysledek,poznamka&order=id.asc',
  events: `funnel_events?event=in.(${EVENTS})&select=id,contact_id,event,meta,occurred_at&order=id.asc`,
  notes: 'poznamky?select=id,contact_id,text,created_at&order=id.asc',
  campaigns: 'kampane?select=id,nazev,stav&order=id.asc',
  deletions: 'v_smazani_zadosti?stav=eq.ceka&select=id,contact_id&order=id.asc',
  team: 'team_members?select=id,jmeno,ghl_jmeno,auth_user_id&order=id.asc',
};

// Every page of every table at once: as many pages as the table had last
// time (2 on the first run), then more while the last page comes back full.
const pagesSeen = {};
async function fetchAll(base, s) {
  const page = async (path, offset) => {
    const res = await fetch(`${base}/rest/v1/${path}&limit=${PAGE}&offset=${offset}`, { headers: { apikey: env.RESULTSON_APIKEY, Authorization: `Bearer ${s.token}` } });
    if (res.status === 401) { session = null; throw Object.assign(new Error('CRM session expired'), { expired: true }); }
    if (!res.ok) throw new Error(`CRM returned ${res.status} for ${path.split('?')[0]}`);
    return res.json();
  };
  const table = async (name) => {
    const n = pagesSeen[name] || 2;
    const pages = await Promise.all(Array.from({ length: n }, (_, i) => page(TABLES[name], i * PAGE)));
    while (pages.at(-1).length === PAGE) pages.push(await page(TABLES[name], pages.length * PAGE));
    pagesSeen[name] = pages.length;
    return pages.flat();
  };
  const names = Object.keys(TABLES);
  const data = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await table(n)])));
  data.me = data.team.find((m) => m.auth_user_id === s.userId);
  if (!data.me) throw new Error('CRM login is not a team member');
  return data;
}

export async function resultsonPeople() {
  const base = env.RESULTSON_URL.replace(/\/$/, '');
  let data;
  try { data = await fetchAll(base, await login(base)); }
  catch (e) { if (!e.expired) throw e; data = await fetchAll(base, await login(base)); }
  return toPeople(data);
}
