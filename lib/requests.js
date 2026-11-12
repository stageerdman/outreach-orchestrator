// AI requests: drafts waiting for the user, in requests.json in the app data
// folder. { id, personId, personName, kind: message|meeting, status, channel,
// subject, text, reasoning, templateId, note, error, createdAt, updatedAt,
// taskId, context: { stage, task, messages } the AI saw, recoveredFrom,
// own: true for a message the user typed in the composer (sent at once) }
// status: generating → pending | failed; pending → sent | cancelled | done | regenerated.
import { randomUUID } from 'node:crypto';
import { readData, writeData } from './cache.js';
import { events } from './events.js';

export const OPEN = ['generating', 'pending', 'failed'];
// A person with a draft on the way or waiting can't get another one.
export const BUSY = ['generating', 'pending'];

let all;
const load = () => (all ??= readData('requests', []));
const save = (r) => {
  writeData('requests', all);
  events.emit('requests', { id: r.id, personId: r.personId, status: r.status });
};

export const listRequests = () => load();
export const getRequest = (id) => load().find((r) => r.id === id);
export const isBusy = (personId, list = load()) => list.some((r) => r.personId === personId && BUSY.includes(r.status));

export function createRequest(person, context = null, fields = {}) {
  const now = new Date().toISOString();
  const r = { id: randomUUID(), personId: person.id, personName: person.name, kind: 'message', status: 'generating',
    channel: null, subject: '', text: '', reasoning: '', templateId: null, note: '', error: '', createdAt: now, updatedAt: now,
    taskId: person.task?.id ?? null, context, ...fields };
  load().push(r);
  save(r);
  return r;
}

export function updateRequest(id, patch) {
  const r = getRequest(id);
  if (!r) return null;
  Object.assign(r, patch, { updatedAt: new Date().toISOString() });
  save(r);
  return r;
}

// Earlier drafts for a person that were never sent, oldest first: what the AI
// proposed and what the user said about it.
export const unsentDrafts = (personId, list = load()) =>
  list.filter((r) => r.personId === personId && ['pending', 'cancelled', 'regenerated', 'done'].includes(r.status) && r.text);

// Drafts sent after the last refresh aren't in the history yet.
export const sentSince = (personId, at, list = load()) =>
  list.filter((r) => r.personId === personId && r.status === 'sent' && (!at || r.updatedAt > at));
