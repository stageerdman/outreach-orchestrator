// Refresh = people from the CRM, then every person's history from every
// channel, kept as an in-memory snapshot. Nothing private is written to disk.
import { listPeople } from './crm.js';
import { emailSession } from './email.js';
import { whatsappSession, whatsappBackfill } from './whatsapp.js';

// A new channel = a lib/<channel>.js with a <channel>Session(), added here.
const SOURCES = { email: emailSession, whatsapp: whatsappSession };

// Pulls every person's history through one session per source. A source that
// fails to open, or fails for one person, is recorded and skipped, never fatal.
export async function collect(people, sources = SOURCES, onProgress = () => {}) {
  const errors = {}, sessions = {};
  for (const [name, open] of Object.entries(sources)) {
    try { sessions[name] = await open(); } catch (e) { errors[name] = e.message; }
  }
  const out = [];
  try {
    for (const p of people) {
      const messages = [], personErrors = {};
      for (const [name, s] of Object.entries(sessions)) {
        try { messages.push(...await s.history(p)); } catch (e) { personErrors[name] = e.message; }
      }
      messages.sort((a, b) => a.at.localeCompare(b.at));
      const counts = Object.fromEntries(Object.keys(sources)
        .map((n) => [n, messages.filter((m) => m.channel === n).length]));
      out.push({ ...p, messages, counts, lastAt: messages.at(-1)?.at ?? null, errors: personErrors });
      onProgress(out.length);
    }
  } finally {
    await Promise.all(Object.values(sessions).map((s) => s.close()));
  }
  // Most recent contact first; never-contacted people after, by name.
  out.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.name.localeCompare(b.name));
  return { people: out, errors };
}

let state = { running: false, stage: null, done: 0, total: 0, at: null, errors: {} };
let snapshot = [];

export const syncState = () => state;
export const snapshotPeople = () => snapshot;

async function publish(people) {
  state = { ...state, stage: 'history', done: 0, total: people.length };
  const result = await collect(people, SOURCES, (n) => { state.done = n; });
  snapshot = result.people;
  state = { ...state, errors: { ...state.errors, ...result.errors }, at: new Date().toISOString() };
}

// Starts a refresh unless one is running: people and history are published
// first, then older WhatsApp history is fetched for these people's chats and
// published again if anything arrived. A failed CRM keeps the old snapshot.
export function refresh() {
  if (state.running) return;
  state = { ...state, running: true, stage: 'people', done: 0, total: 0, errors: {} };
  (async () => {
    const people = await listPeople();
    await publish(people);
    state = { ...state, stage: 'whatsapp', done: 0, total: 0 };
    const added = await whatsappBackfill(people, (n, total) => { state.done = n; state.total = total; })
      .catch((e) => { state.errors = { ...state.errors, whatsapp: `older history: ${e.message}` }; return 0; });
    if (added) await publish(people);
  })()
    .catch((e) => { state.errors = { ...state.errors, crm: e.message }; })
    .finally(() => { state = { ...state, running: false, stage: null }; });
}
