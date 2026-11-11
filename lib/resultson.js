// ResultsON CRM (Supabase/PostgREST): my open tasks, the people behind them,
// and their pipeline stage worked out from call results and task rules.
// Logs in as a team member on every refresh (tokens last 1h).
const env = process.env;
export const resultsonConfigured = () => Boolean(env.RESULTSON_URL);

// The user's pipeline, top (furthest along) first.
export const STAGES = [
  'Installment', 'Waiting for Payment', 'Thinking about it', 'No Show',
  'Meeting Confirmed', 'Meeting Booked', 'Answered', 'Not answered', 'New lead',
];

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

// Installment is the person's stage, not the task's: an installment task
// (open or closed) or an installment-sale note keeps them there.
// Specific signals first (installment, sold, consultation happened, no-show),
// then the furthest call result ever reached, so a later missed call doesn't
// move anyone back. A consultation that happened outranks an earlier no-show.
export function stageOf(task, results, { installment = false, sold = false, consulted = false, noShow = false, booked = false } = {}) {
  const rule = (task?.rule || '').toLowerCase();
  const has = (r) => results.includes(r);
  const rank =
    task?.kind === 'splatka' || installment ? 1
    : sold ? 2
    : task?.followType === 'konzultace' || consulted || has('neprodej') ? 3
    : rule.includes('zrušení konzultace') || noShow ? 4
    : has('potvrzeno') ? 5
    : has('termin') || booked || rule.includes('termín domluven') ? 6
    : results.some((r) => r !== 'nedovolano') ? 7
    : results.length ? 8
    : 9;
  return { rank, label: STAGES[rank - 1] };
}

// One person per contact with an open task; their soonest-due task leads.
// pastTasks: all the contacts' tasks, closed ones too, for their notes.
export function toPeople(tasks, contacts, calls, notes = [], followTypes = {}, pastTasks = []) {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const results = {}, flags = {};
  const flag = (id, text) => {
    const f = (flags[id] ??= {});
    f.installment ||= isInstallmentNote(text); f.sold ||= isSoldNote(text); f.consulted ||= isConsultedNote(text);
    f.noShow ||= isNoShowNote(text); f.booked ||= isBookedNote(text);
  };
  for (const c of calls) if (c.vysledek) (results[c.contact_id] ??= []).push(c.vysledek);
  for (const c of calls) flag(c.contact_id, c.poznamka);
  for (const t of [...tasks, ...pastTasks]) {
    flag(t.contact_id, t.note);
    if (t.kind === 'splatka') flags[t.contact_id].installment = true;
  }
  // Notes oldest first, so a later "lost" cancels an earlier sale.
  for (const n of [...notes].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))) {
    if (isLostNote(n.text)) Object.assign((flags[n.contact_id] ??= {}), { sold: false, installment: false });
    else flag(n.contact_id, n.text);
  }
  // Fully paid: no longer paying installments.
  for (const c of contacts) if (c.paid && flags[c.id]) flags[c.id].installment = false;
  const people = new Map();
  for (const t of [...tasks].sort((a, b) => a.due_at.localeCompare(b.due_at))) {
    if (people.has(t.contact_id)) continue;
    const c = byId.get(t.contact_id) || {};
    const task = { id: t.task_id, kind: t.kind, rule: t.rule_name || '', followType: followTypes[t.task_id] || '', dueAt: t.due_at, note: t.note || '' };
    people.set(t.contact_id, {
      id: t.contact_id,
      name: c.name || t.name || c.email || 'Unknown',
      company: c.funnel || '',
      emails: [c.email].filter(Boolean).map((e) => e.trim().toLowerCase()),
      phones: [c.phone_e164 || c.phone].filter(Boolean),
      task,
      stage: stageOf(task, results[t.contact_id] || [], flags[t.contact_id]),
    });
  }
  return [...people.values()];
}

export async function resultsonPeople() {
  const base = env.RESULTSON_URL.replace(/\/$/, '');
  const login = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.RESULTSON_APIKEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.RESULTSON_EMAIL, password: env.RESULTSON_PASSWORD }),
  });
  const auth = await login.json().catch(() => ({}));
  if (!login.ok) throw new Error(`CRM login failed: ${auth.error_description || auth.msg || login.status}`);

  const get = async (path) => {
    const res = await fetch(`${base}/rest/v1/${path}`, {
      headers: { apikey: env.RESULTSON_APIKEY, Authorization: `Bearer ${auth.access_token}` },
    });
    if (!res.ok) throw new Error(`CRM returned ${res.status} for ${path.split('?')[0]}`);
    return res.json();
  };
  const [me] = await get(`team_members?auth_user_id=eq.${auth.user.id}&select=id`);
  if (!me) throw new Error('CRM login is not a team member');
  const tasks = await get(`v_queue?assigned_to=eq.${me.id}&select=task_id,contact_id,name,kind,rule_name,due_at,note`);
  const ids = [...new Set(tasks.map((t) => t.contact_id))];
  if (ids.length === 0) return [];
  const list = `in.(${ids.join(',')})`;
  const [contacts, calls, notes, taskRows] = await Promise.all([
    get(`contacts?id=${list}&select=id,name,email,phone,phone_e164,funnel,paid`),
    get(`hovory?contact_id=${list}&select=contact_id,vysledek,poznamka`),
    get(`poznamky?contact_id=${list}&select=contact_id,text,created_at`),
    // All their tasks, closed ones too: follow_typ isn't in v_queue
    // ("konzultace" = follow-up after a consultation), and old task notes say
    // how earlier meetings went.
    get(`tasks?contact_id=${list}&select=id,contact_id,kind,follow_typ,note`),
  ]);
  const followTypes = Object.fromEntries(taskRows.map((t) => [t.id, t.follow_typ]));
  return toPeople(tasks, contacts, calls, notes, followTypes, taskRows);
}
