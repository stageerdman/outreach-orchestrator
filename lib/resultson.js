// ResultsON CRM (Supabase/PostgREST): my open tasks, the people behind them,
// and their pipeline stage worked out from call results and task rules.
// Logs in as a team member on every refresh (tokens last 1h).
const env = process.env;
export const resultsonConfigured = () => Boolean(env.RESULTSON_URL);

// The user's pipeline, furthest along first.
export const STAGES = [
  'Paying (installments)', 'Bought LTO / upsell', 'Consultation confirmed',
  'Consultation booked', 'Consultation cancelled', 'Follow-up',
  'Talked (triage)', 'Questionnaire filled', 'New / not reached yet',
];

// Furthest stage reached, from the open task and every logged call result,
// so a later missed call doesn't move anyone back.
export function stageOf(task, results) {
  const rule = (task?.rule || '').toLowerCase();
  const has = (r) => results.includes(r);
  const rank =
    task?.kind === 'splatka' ? 1
    : rule.includes('lto') ? 2
    : has('potvrzeno') ? 3
    : has('termin') || rule.includes('termín domluven') ? 4
    : has('zruseno') || rule.includes('zrušení konzultace') ? 5
    : has('follow') ? 6
    : has('triage') ? 7
    : rule.includes('dotazník') ? 8
    : 9;
  return { rank, label: STAGES[rank - 1] };
}

// One person per contact with an open task; their soonest-due task leads.
export function toPeople(tasks, contacts, calls) {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const results = {};
  for (const c of calls) if (c.vysledek) (results[c.contact_id] ??= []).push(c.vysledek);
  const people = new Map();
  for (const t of [...tasks].sort((a, b) => a.due_at.localeCompare(b.due_at))) {
    if (people.has(t.contact_id)) continue;
    const c = byId.get(t.contact_id) || {};
    const task = { kind: t.kind, rule: t.rule_name || '', dueAt: t.due_at, note: t.note || '' };
    people.set(t.contact_id, {
      id: t.contact_id,
      name: c.name || t.name || c.email || 'Unknown',
      company: c.funnel || '',
      emails: [c.email].filter(Boolean).map((e) => e.trim().toLowerCase()),
      phones: [c.phone_e164 || c.phone].filter(Boolean),
      task,
      stage: stageOf(task, results[t.contact_id] || []),
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
  const tasks = await get(`v_queue?assigned_to=eq.${me.id}&select=contact_id,name,kind,rule_name,due_at,note`);
  const ids = [...new Set(tasks.map((t) => t.contact_id))];
  if (ids.length === 0) return [];
  const list = `in.(${ids.join(',')})`;
  const [contacts, calls] = await Promise.all([
    get(`contacts?id=${list}&select=id,name,email,phone,phone_e164,funnel`),
    get(`hovory?contact_id=${list}&select=contact_id,vysledek`),
  ]);
  return toPeople(tasks, contacts, calls);
}
