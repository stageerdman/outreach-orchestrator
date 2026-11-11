// People list from your custom CRM.
// Set CRM_URL to an endpoint that returns a JSON array of people (or an object
// holding that array at CRM_LIST_PATH). Map your field names with CRM_*_FIELD.
// Without CRM_URL, data/people.sample.json is used.
import { readFile } from 'node:fs/promises';

const env = process.env;
const field = (name, fallback) => env[`CRM_${name}_FIELD`] || fallback;

// Read "a.b.c" style paths so nested CRM fields can be mapped.
export function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function normalize(raw) {
  const emails = [].concat(get(raw, field('EMAIL', 'email')) ?? []).filter(Boolean);
  const phones = [].concat(get(raw, field('PHONE', 'phone')) ?? []).filter(Boolean);
  return {
    id: String(get(raw, field('ID', 'id'))),
    name: get(raw, field('NAME', 'name')) || emails[0] || phones[0] || 'Unknown',
    company: get(raw, field('COMPANY', 'company')) || '',
    emails: emails.map((e) => String(e).trim().toLowerCase()),
    phones: phones.map(String),
  };
}

export async function listPeople() {
  let rows;
  if (env.CRM_URL) {
    const headers = { Accept: 'application/json' };
    if (env.CRM_TOKEN) headers[env.CRM_AUTH_HEADER || 'Authorization'] =
      (env.CRM_AUTH_PREFIX ?? 'Bearer ') + env.CRM_TOKEN;
    const res = await fetch(env.CRM_URL, { headers });
    if (!res.ok) throw new Error(`CRM returned ${res.status} ${res.statusText}`);
    const body = await res.json();
    rows = env.CRM_LIST_PATH ? get(body, env.CRM_LIST_PATH) : body;
  } else {
    rows = JSON.parse(await readFile(new URL('../data/people.sample.json', import.meta.url), 'utf8'));
  }
  if (!Array.isArray(rows)) throw new Error('CRM response is not a list (set CRM_LIST_PATH)');

  return rows.map(normalize);
}

export const crmSource = () => (env.CRM_URL ? 'crm' : 'sample');
