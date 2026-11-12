// The AI assistant: drafts a follow-up (or a "book a meeting" request) per
// person from their history, task, templates and style guide, and learns the
// user's style from their past replies. Runs through Claude Code in the background.
import { askClaude } from './claude.js';
import { getSettings, saveSettings, prompts } from './settings.js';
import { listTemplates } from './templates.js';
import { htmlToText } from '../public/resolve.js';
import { snapshotPeople, syncState } from './sync.js';
import { sendEmail } from './email.js';
import { openWhatsApp, whatsappKnown } from './whatsapp.js';
import * as store from './requests.js';
import { styleCorpus, stylePromptInput } from './style.js';
import { listPlaybooks, renderPlaybooks } from './playbooks.js';
import { learnFrom } from './coach.js';

const HISTORY = 30, CLIP = 1200;
// All times the AI sees are Prague time, whatever the Mac's own timezone is.
const TZ = 'Europe/Prague';
const stamp = (at) => new Date(at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ });
const clip = (s, n = CLIP) => (s.length > n ? s.slice(0, n) + ' …' : s);
const LABEL = { email: 'Email', whatsapp: 'WhatsApp' };
const KIND = { call: 'Call', followup: 'Follow up', confirm: 'Confirm consultation', splatka: 'Installment' };

// WhatsApp only on a number known to be on WhatsApp, unless there's no email.
export function channelsOf(p, onWa = whatsappKnown) {
  const wa = p.phones.find(onWa) ?? (p.emails.length ? undefined : p.phones[0]);
  return { ...(wa ? { whatsapp: wa } : {}), ...(p.emails.length ? { email: p.emails[0] } : {}) };
}

// The channels a draft may use: all the person's, or only the one the user picked.
export function draftChannels(p, only = null, onWa = whatsappKnown) {
  const all = Object.keys(channelsOf(p, onWa));
  return only && all.includes(only) ? [only] : all;
}

// "Re: <the last email's subject>", or '' when there's no email yet.
export function replySubject(messages = []) {
  const last = messages.filter((m) => m.channel === 'email').at(-1);
  return last ? `Re: ${(last.subject || '').replace(/^(re:\s*)+/i, '')}` : '';
}

const renderMessage = (m, who) =>
  `[${stamp(m.at)} · ${LABEL[m.channel]} · ${who}]${m.subject ? ` Subject: ${m.subject}` : ''}\n${clip(m.text || '')}`;

// Where the client is in a follow-up sequence: my touches since the client's
// last message (messages of mine less than 6 hours apart are one touch).
const DAY = 864e5, TOUCH_GAP = 6 * 36e5;
export function followupState(messages = [], now = new Date()) {
  const lastClient = messages.findLastIndex((m) => !m.fromMe);
  const mine = messages.slice(lastClient + 1).filter((m) => m.fromMe);
  const touches = mine.filter((m, i) => i === 0 || new Date(m.at) - new Date(mine[i - 1].at) > TOUCH_GAP);
  const days = (at) => (at ? Math.floor((now - new Date(at)) / DAY) : null);
  return {
    followups: touches.length, clientEverWrote: lastClient >= 0,
    daysSinceClient: lastClient >= 0 ? days(messages[lastClient].at) : null,
    daysSinceMine: days(mine.at(-1)?.at), channels: touches.map((m) => m.channel),
  };
}
export const renderFollowup = (f) => (!f.clientEverWrote && !f.followups ? 'No messages yet: first contact.'
  : (f.followups ? `${f.followups} message(s) sent since the client last wrote (${f.channels.join(' → ')}), the last ${f.daysSinceMine} day(s) ago.` : 'The client wrote last; nothing sent since.')
    + (f.clientEverWrote ? ` The client last wrote ${f.daysSinceClient} day(s) ago.` : ' The client has never written.'));

// What the AI saw for a draft, kept with it: the user's later decision on the
// draft (sent, cancelled with a reason) plus this is training data.
const toContextMessage = ({ channel, id, at, fromMe, from, subject, text }) => ({ channel, id, at, fromMe, from, subject, text: clip(text || '') });
export const contextOf = (p, now = new Date()) => ({ stage: p.stage?.label || '', task: p.task || null,
  followup: followupState(p.messages, now), messages: (p.messages || []).slice(-HISTORY).map(toContextMessage) });

// Stable across a batch (good for prompt caching): instructions, style, templates.
const PLAYBOOK_HOW = `Our follow-up strategy. Find the playbook for the client's pipeline stage and situation (no reply from the client vs. an ongoing conversation; "any" stages = universal). Without a reply, the follow-up position tells the step: after N messages sent since the client last wrote, use step N+1 once its wait (days since our last message) has passed. When the client replied, use the response branch that matches what they said. Follow the step's ask, why and channel, and use its templates first. Respect the lessons. Deviate only when the conversation clearly calls for it, and say why. Set "playbookId" and "stepId" (a step or response id) to what you followed, or null.`;

export function systemPrompt(settings, templates, playbooks = listPlaybooks()) {
  const style = settings.styleGuide.trim() || '(No style guide yet: write briefly, friendly and professional, like the user\'s earlier messages.)';
  const tpls = templates.map((t) => `## ${t.id} · ${t.name || 'Untitled'}\n${t.subject ? `Subject: ${t.subject}\n` : ''}${htmlToText(t.bodyHtml)}`);
  const pbs = playbooks.length ? `\n\n# Playbooks\n${PLAYBOOK_HOW}\n\n${renderPlaybooks(playbooks, templates)}` : '';
  return `${prompts(settings).draft}${pbs}\n\n# Style guide\n${style}\n\n# Templates\n${tpls.join('\n\n') || '(none)'}`;
}

// Everything about this one person, newest facts last.
export function contextPrompt({ person: p, drafts = [], sent = [], instruction = '', now = new Date(), onWa = whatsappKnown }) {
  const ch = channelsOf(p, onWa);
  const noWa = p.phones.length && !p.phones.some(onWa);
  const due = p.task?.dueAt ? `due ${stamp(p.task.dueAt)}${new Date(p.task.dueAt) < now ? ' (overdue)' : ''}` : '';
  const out = [
    `Now: ${stamp(now)} (${now.toLocaleDateString('en', { weekday: 'long', timeZone: TZ })}). All times here are Prague time (Europe/Prague); any time you or the client mention means Prague time.`,
    `# Client\nName: ${p.name}${p.company ? `\nSource: ${p.company}` : ''}`
      + `\nPipeline stage: ${p.stage?.label || 'unknown'}`
      + (p.task ? `\nTask: ${[KIND[p.task.kind] || p.task.kind, p.task.rule, due].filter(Boolean).join(' · ')}` : '')
      + (p.task?.note ? `\nTask note: ${p.task.note}` : '')
      + `\nFollow-up position: ${renderFollowup(followupState(p.messages, now))}`
      + `\nAvailable channels: ${Object.entries(ch).map(([k, v]) => `${k} (${v})`).join(', ')}`
      + (noWa ? `\nWhatsApp: ${p.phones.join(', ')} was not found on WhatsApp (probably no account)${ch.whatsapp ? '; use it only if there is no other way' : ''}.` : ''),
  ];
  const msgs = (p.messages || []).slice(-HISTORY);
  out.push(`# Conversation (last ${msgs.length}, oldest first)\n` +
    (msgs.map((m) => renderMessage(m, m.fromMe ? 'ME' : 'CLIENT')).join('\n\n') || '(no messages yet)'));
  if (sent.length) out.push(`# Sent by me since the last sync (not in the conversation above yet)\n` +
    sent.map((r) => renderMessage({ ...r, at: r.updatedAt }, 'ME')).join('\n\n'));
  if (drafts.length) out.push(`# Your earlier drafts for this client (not sent)\n` + drafts.map((r) => {
    const what = { pending: 'still waiting for approval', cancelled: 'cancelled by the user', regenerated: 'the user asked for a new version', done: 'meeting request: the user offered the client a meeting (an activity done, not a meeting booked; the conversation and stage show whether it got booked)' }[r.status];
    const edited = r.aiText != null && r.aiText.trim() !== r.text.trim() ? ' · the user edited it: this is their version' : '';
    return `[${stamp(r.createdAt)} · ${r.kind === 'meeting' ? 'meeting request' : LABEL[r.channel]} · ${what}${edited}${r.note ? ` · reason: "${r.note}"` : ''}]\n${clip(r.text)}`;
  }).join('\n\n'));
  if (instruction) out.push(`# The user's instruction for this draft\n${instruction}`);
  out.push('Prepare the next step for this client now.');
  return out.join('\n\n');
}

export const draftSchema = (channels) => ({
  type: 'object', additionalProperties: false,
  required: ['action', 'channel', 'subject', 'text', 'templateId', 'playbookId', 'stepId', 'reasoning'],
  properties: {
    action: { type: 'string', enum: ['message', 'meeting'] },
    channel: { type: 'string', enum: channels },
    subject: { type: 'string', description: 'Email subject; empty for WhatsApp and meetings' },
    text: { type: 'string', description: 'The message, or for a meeting a one-line brief of what to book' },
    templateId: { type: ['string', 'null'] },
    playbookId: { type: ['string', 'null'] },
    stepId: { type: ['string', 'null'], description: 'The playbook step or response id followed' },
    reasoning: { type: 'string' },
  },
});

// Turns Claude's answer into request fields, keeping only valid values.
export function toDraft(answer, channels, templates, playbooks = []) {
  const channel = channels.includes(answer.channel) ? answer.channel : channels[0];
  const pb = playbooks.find((p) => p.id === answer.playbookId);
  const stepId = pb && [...pb.steps, ...pb.responses].some((x) => x.id === answer.stepId) ? answer.stepId : null;
  return {
    kind: answer.action === 'meeting' ? 'meeting' : 'message', channel,
    subject: channel === 'email' && answer.action !== 'meeting' ? answer.subject.trim() : '',
    text: answer.text.trim(), reasoning: answer.reasoning.trim(),
    templateId: templates.some((t) => t.id === answer.templateId) ? answer.templateId : null,
    playbookId: pb?.id ?? null, stepId,
  };
}

async function run(r, person, instruction) {
  try {
    const settings = getSettings(), templates = listTemplates(), playbooks = listPlaybooks(), channels = draftChannels(person, r.channel);
    const answer = await askClaude({
      model: settings.model,
      system: systemPrompt(settings, templates, playbooks),
      prompt: contextPrompt({
        person, instruction,
        drafts: store.unsentDrafts(person.id).filter((d) => d.id !== r.id),
        sent: store.sentSince(person.id, syncState().at),
      }),
      schema: draftSchema(channels),
    });
    // The user may have cancelled it while Claude was writing.
    if (store.getRequest(r.id).status === 'generating') {
      const d = toDraft(answer, channels, templates, playbooks);
      store.updateRequest(r.id, { ...d, aiText: d.text, aiSubject: d.subject, status: 'pending' });
    }
  } catch (e) {
    if (store.getRequest(r.id).status === 'generating') store.updateRequest(r.id, { status: 'failed', error: e.message });
  }
}

// Starts drafts for these people in the background; skips anyone busy or
// unreachable. Returns the new requests. channel: only this one (if the person
// has it); previousId: the draft this one replaces (a regenerate).
export function draft(personIds, instruction = '', { channel = null, previousId = null } = {}) {
  const people = snapshotPeople(), out = [];
  for (const id of personIds) {
    const p = people.find((x) => x.id === id);
    if (!p || store.isBusy(id) || !Object.keys(channelsOf(p)).length) continue;
    for (const f of store.listRequests().filter((x) => x.personId === id && x.status === 'failed')) store.updateRequest(f.id, { status: 'cancelled' });
    const chs = draftChannels(p, channel);
    const r = store.createRequest(p, contextOf(p), { channel: chs.length === 1 ? chs[0] : null, instruction, previousId });
    run(r, p, instruction);
    out.push(r);
  }
  return out;
}

const closed = (r) => !r || !store.OPEN.includes(r.status);

export function regenerate(id, note = '', channel = null) {
  const r = store.getRequest(id);
  if (closed(r)) return null;
  store.updateRequest(id, { status: r.status === 'failed' ? 'cancelled' : 'regenerated', note });
  if (r.status === 'pending') learnFrom(requestWithContext(id), 'regenerate');
  return draft([r.personId], note, { channel, previousId: id })[0] ?? null;
}

// Cancelling a written draft is a lesson for the playbooks.
export function cancel(id, note = '') {
  const r = store.getRequest(id);
  if (closed(r)) return null;
  const wasDraft = r.status === 'pending';
  const out = store.updateRequest(id, { status: 'cancelled', note });
  if (wasDraft) learnFrom(requestWithContext(id), 'cancel');
  return out;
}

// Why a cancelled draft can't come back ('' = it can): the task still exists,
// nothing was sent since, and no other draft is on the way.
export function recoverBlock(r, people = snapshotPeople(), list = store.listRequests(), onWa = whatsappKnown) {
  if (r.status !== 'cancelled') return 'Only cancelled drafts can be recovered';
  if (!r.text) return 'Cancelled before a draft was written';
  if (list.some((x) => x.recoveredFrom === r.id)) return 'Already recovered';
  const p = people.find((x) => x.id === r.personId);
  if (!p) return 'No open task for this person any more';
  if (r.taskId != null && p.task?.id !== r.taskId) return 'The task it was for is closed';
  if (store.isBusy(p.id, list)) return 'Another draft for this person is waiting';
  if (list.some((x) => x.personId === p.id && ['sent', 'done'].includes(x.status) && x.updatedAt > r.createdAt)) return 'A later draft was sent';
  if ((p.messages || []).some((m) => m.fromMe && m.at > r.createdAt)) return 'You wrote to them since';
  if (r.kind !== 'meeting' && !(r.channel in channelsOf(p, onWa))) return `${LABEL[r.channel] || 'This channel'} isn't available for this person any more`;
  return '';
}

// A copy goes back to "waiting"; the cancelled one stays as the record.
export function recover(id) {
  const r = store.getRequest(id);
  if (!r) return null;
  const why = recoverBlock(r);
  if (why) throw Object.assign(new Error(why), { status: 409 });
  const p = snapshotPeople().find((x) => x.id === r.personId);
  const { kind, channel, subject, text, reasoning, templateId, taskId } = r;
  return store.createRequest(p, requestWithContext(id).context, { kind, channel, subject, text, reasoning, templateId, taskId, status: 'pending', recoveredFrom: r.id });
}

// The list without the (large) contexts; cancelled ones say whether they can come back.
export function listForUi() {
  const people = snapshotPeople(), list = store.listRequests();
  return list.map(({ context, ...r }) => (r.status === 'cancelled' ? { ...r, recover: recoverBlock(r, people, list) } : r));
}

// One request with its context. Drafts from before contexts were kept get one
// rebuilt from the current history, up to when they were drafted.
export function requestWithContext(id) {
  const r = store.getRequest(id);
  if (!r) return null;
  if (r.context) return r;
  const p = snapshotPeople().find((x) => x.id === r.personId);
  const messages = (p?.messages || []).filter((m) => m.at <= r.createdAt).slice(-HISTORY).map(toContextMessage);
  return { ...r, context: { stage: '', task: null, messages, rebuilt: true } };
}

// Email: sent over SMTP, as a reply to the last email. WhatsApp: opened in the
// app with the text filled in (the user presses send there). Meeting: done.
export async function approve(id, { text, subject } = {}) {
  const r = store.getRequest(id);
  if (!r || r.status !== 'pending') throw new Error('This request is no longer waiting');
  if (typeof text === 'string') r.text = text;
  if (typeof subject === 'string') r.subject = subject;
  if (r.kind === 'meeting') {
    const out = store.updateRequest(id, { status: 'done' });
    learnFrom(requestWithContext(id), 'approve');
    return out;
  }
  const p = snapshotPeople().find((x) => x.id === r.personId);
  const to = p && (r.channel === 'email' ? p.emails[0] : p.phones[0]);
  if (!to) throw new Error(`No ${LABEL[r.channel]} contact for this person any more`);
  if (r.channel === 'email') {
    const last = p.messages.filter((m) => m.channel === 'email').at(-1);
    await sendEmail({ to, subject: r.subject || replySubject(p.messages), text: r.text, inReplyTo: last?.messageId });
  } else await openWhatsApp(to, r.text);
  const out = store.updateRequest(id, { status: 'sent', text: r.text, subject: r.subject });
  learnFrom(requestWithContext(id), 'approve');
  return out;
}

// Text and subject as typed; a channel switch (no AI run) fills an email's
// subject as a reply to the last email.
export function editRequest(id, { text, subject, channel }, people = snapshotPeople(), onWa = whatsappKnown) {
  const r = store.getRequest(id);
  if (!r || r.status !== 'pending') return null;
  const patch = { ...(typeof text === 'string' && { text }), ...(typeof subject === 'string' && { subject }) };
  if (channel && channel !== r.channel && r.kind === 'message') {
    const p = people.find((x) => x.id === r.personId);
    if (!p || !(channel in channelsOf(p, onWa))) throw Object.assign(new Error(`${LABEL[channel] || channel} isn't available for this person`), { status: 409 });
    patch.channel = channel;
    patch.subject = channel === 'email' ? (patch.subject ?? r.subject) || replySubject(p.messages) : '';
  }
  return store.updateRequest(id, patch);
}

// ---- style learning: one run over the user's conversations
let learning = { running: false, error: '', count: 0 };
export const learnState = () => learning;

export function learnStyle() {
  if (learning.running) return learning;
  const corpus = styleCorpus(snapshotPeople());
  if (!corpus.count) return (learning = { running: false, error: 'No sent messages yet: refresh first', count: 0 });
  learning = { running: true, error: '', count: corpus.count };
  const settings = getSettings();
  askClaude({
    model: settings.model, system: 'You analyse how one person writes, precisely and only from evidence.',
    prompt: stylePromptInput(corpus, prompts(settings).style),
    schema: { type: 'object', additionalProperties: false, required: ['styleGuide'], properties: { styleGuide: { type: 'string' } } },
  })
    .then(({ styleGuide }) => { saveSettings({ styleGuide, styleLearnedAt: new Date().toISOString(), styleCount: corpus.count }); learning = { ...learning, running: false }; })
    .catch((e) => { learning = { ...learning, running: false, error: e.message }; });
  return learning;
}
