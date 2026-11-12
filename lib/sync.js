// Refresh = people from the CRM, then every person's history from every
// channel, as a snapshot served by the API and saved to the local cache
// (outside the repo) so the app opens with the last data. Channels are
// collected one after another and each is published as soon as it's in
// (WhatsApp is local and instant, email follows). Afterwards, live watchers
// re-collect single people when new messages arrive, and older WhatsApp
// history is fetched in the background.
import { listPeople } from './crm.js';
import { getJSON, setJSON } from './cache.js';
import { emailSession, emailWatch } from './email.js';
import { whatsappSession, whatsappBackfill, whatsappWatch, whatsappOwners } from './whatsapp.js';
import { events } from './events.js';

// A new channel = a lib/<channel>.js with a <channel>Session(people), added
// here; fastest first, since each one is published as soon as it's collected.
const SOURCES = { whatsapp: whatsappSession, email: emailSession };
const NAMES = Object.keys(SOURCES);

const byAt = (a, b) => a.at.localeCompare(b.at);
const summarize = (p, names = NAMES) => ({ ...p,
  counts: Object.fromEntries(names.map((n) => [n, p.messages.filter((m) => m.channel === n).length])),
  lastAt: p.messages.at(-1)?.at ?? null });

// One channel's messages for these people. A session that fails to open is
// `error`; a failure for one person is kept in `failed`, never fatal.
export async function collectChannel(people, open, onProgress = () => {}) {
  const byId = new Map(), failed = new Map();
  let s;
  try { s = await open(people); } catch (e) { return { byId, failed, error: e.message }; }
  try {
    for (const p of people) {
      try { byId.set(p.id, await s.history(p)); } catch (e) { failed.set(p.id, e.message); }
      onProgress(byId.size + failed.size);
    }
  } finally {
    await s.close();
  }
  return { byId, failed };
}

// A (fresh) CRM list with everyone's messages and errors from the current
// snapshot, until each channel is collected again.
export function carryOver(people, previous, names = NAMES) {
  const old = new Map(previous.map((p) => [p.id, p]));
  return people.map((p) => summarize({ ...p, messages: old.get(p.id)?.messages ?? [], errors: old.get(p.id)?.errors ?? {} }, names));
}

// Replaces one channel's messages for the people it was collected for; the
// other channels and everyone else stay as they are.
export function mergeChannel(people, name, { byId, failed, error }, names = NAMES) {
  if (error) return people;
  return people.map((p) => {
    if (!byId.has(p.id) && !failed.has(p.id)) return p;
    const { [name]: _, ...errors } = p.errors ?? {};
    if (failed.has(p.id)) errors[name] = failed.get(p.id);
    const messages = byId.has(p.id)
      ? [...(p.messages ?? []).filter((m) => m.channel !== name), ...byId.get(p.id)].sort(byAt) : p.messages ?? [];
    return summarize({ ...p, messages, errors }, names);
  });
}

// Most recent contact first; never-contacted people after, by name.
export const order = (people) =>
  [...people].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.name.localeCompare(b.name));

// Everyone with every channel collected (a whole refresh in one go).
export async function collect(people, sources = SOURCES, onProgress = () => {}) {
  const names = Object.keys(sources), errors = {};
  let out = carryOver(people, [], names);
  for (const [name, open] of Object.entries(sources)) {
    const r = await collectChannel(people, open, onProgress);
    if (r.error) errors[name] = r.error;
    out = mergeChannel(out, name, r, names);
  }
  return { people: order(out), errors };
}

// running: a refresh is bringing user-visible data (CRM, then each channel).
// backfill: older WhatsApp history being fetched in the background (its
// failure, e.g. the bridge not running, is backfill.error, not a refresh error).
let state = { running: false, stage: null, done: 0, total: 0, at: null, errors: {}, backfill: { running: false, done: 0, total: 0, error: '' } };
let snapshot = [];

export const syncState = () => state;
export const snapshotPeople = () => snapshot;

// Saving the snapshot: at once after a refresh stage, batched for live updates.
let saveTimer = null;
function persist(now = false) {
  clearTimeout(saveTimer);
  const save = () => setJSON('snapshot', { at: state.at, people: snapshot });
  if (now) save(); else saveTimer = setTimeout(save, 5_000);
}

// Called once at server start: serve the last saved snapshot until a refresh.
export function restoreSnapshot() {
  const saved = getJSON('snapshot');
  if (saved) { snapshot = saved.people; state = { ...state, at: saved.at }; }
}

// Re-collects one channel for some people (live updates), one at a time so a
// slower older update can't overwrite a newer one. Emits `messages` with the
// ids whose messages changed.
let updating = Promise.resolve();
export function updatePeople(ids, name) {
  updating = updating.then(async () => {
    const people = snapshot.filter((p) => ids.includes(p.id));
    if (!people.length) return;
    const r = await collectChannel(people, SOURCES[name]);
    if (r.error) return console.error(`Live ${name}:`, r.error);
    const before = new Map(people.map((p) => [p.id, p.messages.map((m) => m.id).join()]));
    snapshot = order(mergeChannel(snapshot, name, r));
    const changed = snapshot.filter((p) => before.has(p.id) && before.get(p.id) !== p.messages.map((m) => m.id).join()).map((p) => p.id);
    if (changed.length) { persist(); events.emit('messages', { ids: changed }); }
  }).catch((e) => console.error(`Live ${name}:`, e.message));
  return updating;
}

// Older WhatsApp history, in the background after a refresh: only people
// whose chats gained messages are re-collected.
async function backfill(people) {
  state = { ...state, backfill: { running: true, done: 0, total: 0, error: '' } };
  try {
    const jids = await whatsappBackfill(people, (done, total) => { state.backfill = { ...state.backfill, done, total }; });
    const ids = jids.size ? whatsappOwners([...jids], snapshot) : [];
    if (ids.length) await updatePeople(ids, 'whatsapp');
  } catch (e) {
    state = { ...state, backfill: { ...state.backfill, error: e.message } };
  } finally {
    state = { ...state, backfill: { ...state.backfill, running: false } };
  }
}

// Starts a refresh unless one is running. Each channel is published as soon
// as it's collected, merged onto the current snapshot so live updates that
// came in meanwhile aren't lost. A failed CRM keeps the old snapshot.
export function refresh() {
  if (state.running) return;
  state = { ...state, running: true, stage: 'people', done: 0, total: 0, errors: {} };
  let people;
  (async () => {
    people = await listPeople();
    for (const [name, open] of Object.entries(SOURCES)) {
      state = { ...state, stage: name, done: 0, total: people.length };
      const r = await collectChannel(people, open, (n) => { state.done = n; });
      if (r.error) state = { ...state, errors: { ...state.errors, [name]: r.error } };
      snapshot = order(mergeChannel(carryOver(people, snapshot), name, r));
      state = { ...state, at: new Date().toISOString() };
      persist(true);
      events.emit('snapshot', { at: state.at, stage: name });
    }
  })()
    .catch((e) => { state = { ...state, errors: { ...state.errors, crm: e.message } }; })
    .finally(() => {
      state = { ...state, running: false, stage: null };
      if (people && !state.backfill.running) backfill(people);
    });
}

// Live updates: new WhatsApp rows in the bridge DB (checked every second) and
// new mail (IMAP IDLE on INBOX, every folder every 2 min) re-collect only the
// people involved.
export function startLive() {
  whatsappWatch((jids) => {
    const ids = whatsappOwners(jids, snapshot);
    if (ids.length) updatePeople(ids, 'whatsapp');
  });
  emailWatch((addresses) => {
    const set = new Set(addresses);
    const ids = snapshot.filter((p) => (p.emails ?? []).some((e) => set.has(e))).map((p) => p.id);
    if (ids.length) updatePeople(ids, 'email');
  });
}
