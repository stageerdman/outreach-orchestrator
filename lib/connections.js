// What the orchestrator is wired to, for the Connections diagram and for every
// AI that writes to a client (drafts, the Copilot). One entry per connection:
// { id, name, what, flow, status(ctx) → { state: 'live'|'off'|'error', detail, flow? },
//   ai: { where } (its data is already in the client's context, under that heading)
//     or { section: async (person) → text } (its own section of the prompt; '' = nothing) }.
// flow = which way information goes: 'in' (read only), 'out' (write only) or 'both';
// a status may narrow it (email without IMAP only sends).
// ctx = { people (the snapshot), errors (the last refresh's, by source) }.
// A new connection (built from the Connections chat) adds an entry here.
import { crmSource } from './crm.js';
import { emailConfigured, smtpConfigured } from './email.js';
import { whatsappConfigured } from './whatsapp.js';
import { calendarStatus, calendarForAI } from './calendar.js';

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
const chats = (people, channel) => people.filter((p) => p.messages?.some((m) => m.channel === channel)).length;

export const CONNECTIONS = [
  {
    id: 'crm', name: 'ResultsON', what: 'Contacts, stages and tasks', flow: 'in',
    status: ({ people, errors }) => crmSource() === 'sample' ? { state: 'off', detail: 'Not set up — sample people' }
      : errors.crm ? { state: 'error', detail: errors.crm } : { state: 'live', detail: plural(people.length, 'contact') },
    ai: { where: '"# Client" (stage, task, task note, channels)' },
  },
  {
    id: 'whatsapp', name: 'WhatsApp', what: 'Chats, sent from your phone', flow: 'both',
    status: ({ people, errors }) => !whatsappConfigured() ? { state: 'off', detail: 'Not set up' }
      : errors.whatsapp ? { state: 'error', detail: errors.whatsapp } : { state: 'live', detail: plural(chats(people, 'whatsapp'), 'chat') },
    ai: { where: '"# Conversation" (the WhatsApp messages)' },
  },
  {
    id: 'email', name: 'Email', what: 'Inbox and sending', flow: 'both',
    status: ({ people, errors }) => !emailConfigured() ? (smtpConfigured() ? { state: 'live', detail: 'Sending only', flow: 'out' } : { state: 'off', detail: 'Not set up' })
      : errors.email ? { state: 'error', detail: errors.email } : { state: 'live', detail: plural(chats(people, 'email'), 'thread') },
    ai: { where: '"# Conversation" (the emails)' },
  },
  { id: 'calendar', name: 'Google Calendar', what: 'Your free time and meetings with the client, for the AI (read-only)', flow: 'in',
    status: () => calendarStatus(), ai: { section: (person) => calendarForAI(person) } },
];

// For one client's prompt: every connection with what it gave the AI.
// → [{ id, name, what, where?, text? }] (text: its own section; a failing one says so).
export async function connectionsForAI(person, list = CONNECTIONS) {
  return Promise.all(list.filter((c) => c.ai).map(async ({ id, name, what, ai }) => {
    if (ai.where) return { id, name, what, where: ai.where };
    let text;
    try { text = await ai.section(person); } catch (e) { text = `${name} couldn't be read right now (${e.message}).`; }
    return { id, name, what, text: text || '' };
  }));
}

// The prompt part: what the AI is connected to and where each one's data is.
export function renderConnections(list) {
  if (!list.length) return '';
  const head = `# Your connections\nYou are connected to these, read through the app; what each returned for this client is in this prompt. Use it. Never say you have no access to one of them: if what you need isn't in what it returned, say exactly what's missing (e.g. "no meeting with this client in your calendar").\n`
    + list.map((c) => `- ${c.name} (${c.what}): ${c.where ? `in ${c.where}` : c.text ? `below, "# ${c.name}"` : 'not set up, nothing returned'}`).join('\n');
  return [head, ...list.filter((c) => c.text).map((c) => `# ${c.name}\n${c.text}`)].join('\n\n');
}

// Plain objects for the UI; a status that throws shows as an error, never breaks the list.
export function listConnections(ctx, list = CONNECTIONS) {
  return list.map(({ id, name, what, flow = 'in', status }) => {
    let s;
    try { s = status(ctx); } catch (e) { s = { state: 'error', detail: e.message }; }
    return { id, name, what, flow: s.flow ?? flow, state: s.state, detail: s.detail ?? '' };
  });
}
