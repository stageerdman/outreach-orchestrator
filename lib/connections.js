// What the orchestrator is wired to, for the Connections diagram. One entry per
// connection: { id, name, what, flow, status(ctx) → { state: 'live'|'off'|'error', detail, flow? } }.
// flow = which way information goes: 'in' (read only), 'out' (write only) or 'both';
// a status may narrow it (email without IMAP only sends).
// ctx = { people (the snapshot), errors (the last refresh's, by source) }.
// A new connection (built from the Connections chat) adds an entry here.
import { crmSource } from './crm.js';
import { emailConfigured, smtpConfigured } from './email.js';
import { whatsappConfigured } from './whatsapp.js';
import { calendarStatus } from './calendar.js';

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
const chats = (people, channel) => people.filter((p) => p.messages?.some((m) => m.channel === channel)).length;

export const CONNECTIONS = [
  {
    id: 'crm', name: 'ResultsON', what: 'Contacts, stages and tasks', flow: 'in',
    status: ({ people, errors }) => crmSource() === 'sample' ? { state: 'off', detail: 'Not set up — sample people' }
      : errors.crm ? { state: 'error', detail: errors.crm } : { state: 'live', detail: plural(people.length, 'contact') },
  },
  {
    id: 'whatsapp', name: 'WhatsApp', what: 'Chats, sent from your phone', flow: 'both',
    status: ({ people, errors }) => !whatsappConfigured() ? { state: 'off', detail: 'Not set up' }
      : errors.whatsapp ? { state: 'error', detail: errors.whatsapp } : { state: 'live', detail: plural(chats(people, 'whatsapp'), 'chat') },
  },
  {
    id: 'email', name: 'Email', what: 'Inbox and sending', flow: 'both',
    status: ({ people, errors }) => !emailConfigured() ? (smtpConfigured() ? { state: 'live', detail: 'Sending only', flow: 'out' } : { state: 'off', detail: 'Not set up' })
      : errors.email ? { state: 'error', detail: errors.email } : { state: 'live', detail: plural(chats(people, 'email'), 'thread') },
  },
  { id: 'calendar', name: 'Google Calendar', what: 'Your free time, for the AI (read-only)', flow: 'in', status: () => calendarStatus() },
];

// Plain objects for the UI; a status that throws shows as an error, never breaks the list.
export function listConnections(ctx, list = CONNECTIONS) {
  return list.map(({ id, name, what, flow = 'in', status }) => {
    let s;
    try { s = status(ctx); } catch (e) { s = { state: 'error', detail: e.message }; }
    return { id, name, what, flow: s.flow ?? flow, state: s.state, detail: s.detail ?? '' };
  });
}
