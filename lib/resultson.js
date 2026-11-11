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

// A sold note says "Prodáno" (not "Neprodáno").
export const isSoldNote = (text) => /(?<!\p{L})prod[aá]no(?!\p{L})/iu.test(text || '');

// Specific signals first (installment, sold, after-consultation follow-up,
// cancelled consultation), then the furthest call result ever reached, so a
// later missed call doesn't move anyone back.
export function stageOf(task, results, sold = false) {
  const rule = (task?.rule || '').toLowerCase();
  const has = (r) => results.includes(r);
  const rank =
    task?.kind === 'splatka' ? 1
    : sold ? 2
    : task?.followType === 'konzultace' ? 3
    : rule.includes('zrušení konzultace') ? 4
    : has('potvrzeno') ? 5
    : has('termin') || rule.includes('termín domluven') ? 6
    : results.some((r) => r !== 'nedovolano') ? 7
    : results.length ? 8
    : 9;
  return { rank, label: STAGES[rank - 1] };
}

// One person per contact with an open task; their soonest-due task leads.
export function toPeople(tasks, contacts, calls, notes = [], followTypes = {}) {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const results = {}, sold = new Set();
  for (const c of calls) if (c.vysledek) (results[c.contact_id] ??= []).push(c.vysledek);
  for (const c of calls) if (isSoldNote(c.poznamka)) sold.add(c.contact_id);
  for (const n of notes) if (isSoldNote(n.text)) sold.add(n.contact_id);
  for (const t of tasks) if (isSoldNote(t.note)) sold.add(t.contact_id);
  const people = new Map();
  for (const t of [...tasks].sort((a, b) => a.due_at.localeCompare(b.due_at))) {
    if (people.has(t.contact_id)) continue;
    const c = byId.get(t.contact_id) || {};
    const task = { kind: t.kind, rule: t.rule_name || '', followType: followTypes[t.task_id] || '', dueAt: t.due_at, note: t.note || '' };
    people.set(t.contact_id, {
      id: t.contact_id,
      name: c.name || t.name || c.email || 'Unknown',
      company: c.funnel || '',
      emails: [c.email].filter(Boolean).map((e) => e.trim().toLowerCase()),
      phones: [c.phone_e164 || c.phone].filter(Boolean),
      task,
      stage: stageOf(task, results[t.contact_id] || [], sold.has(t.contact_id)),
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
    get(`contacts?id=${list}&select=id,name,email,phone,phone_e164,funnel`),
    get(`hovory?contact_id=${list}&select=contact_id,vysledek,poznamka`),
    get(`poznamky?contact_id=${list}&select=contact_id,text`),
    // follow_typ isn't in v_queue; "konzultace" = follow-up after a consultation
    get(`tasks?id=in.(${tasks.map((t) => t.task_id).join(',')})&select=id,follow_typ`),
  ]);
  const followTypes = Object.fromEntries(taskRows.map((t) => [t.id, t.follow_typ]));
  return toPeople(tasks, contacts, calls, notes, followTypes);
}
