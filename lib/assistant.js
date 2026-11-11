// The AI assistant: drafts a follow-up (or a "book a meeting" request) per
// person from their history, task, templates and style guide, and learns the
// user's style from their past replies. Runs through Claude Code in the background.
import { askClaude } from './claude.js';
import { getSettings, saveSettings, prompts } from './settings.js';
import { listTemplates } from './templates.js';
import { htmlToText } from '../public/resolve.js';
import { snapshotPeople, syncState } from './sync.js';
import { sendEmail } from './email.js';
import { openWhatsApp } from './whatsapp.js';
import * as store from './requests.js';
import { styleCorpus, stylePromptInput } from './style.js';

const HISTORY = 30, CLIP = 1200;
const stamp = (at) => new Date(at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
const clip = (s, n = CLIP) => (s.length > n ? s.slice(0, n) + ' …' : s);
const LABEL = { email: 'Email', whatsapp: 'WhatsApp' };
const KIND = { call: 'Call', followup: 'Follow up', confirm: 'Confirm consultation', splatka: 'Installment' };

export const channelsOf = (p) => ({
  ...(p.phones.length ? { whatsapp: p.phones[0] } : {}),
  ...(p.emails.length ? { email: p.emails[0] } : {}),
});

const renderMessage = (m, who) =>
  `[${stamp(m.at)} · ${LABEL[m.channel]} · ${who}]${m.subject ? ` Subject: ${m.subject}` : ''}\n${clip(m.text || '')}`;

// Stable across a batch (good for prompt caching): instructions, style, templates.
export function systemPrompt(settings, templates) {
  const style = settings.styleGuide.trim() || '(No style guide yet: write briefly, friendly and professional, like the user\'s earlier messages.)';
  const tpls = templates.map((t) => `## ${t.id} · ${t.name || 'Untitled'}\n${t.subject ? `Subject: ${t.subject}\n` : ''}${htmlToText(t.bodyHtml)}`);
  return `${prompts(settings).draft}\n\n# Style guide\n${style}\n\n# Templates\n${tpls.join('\n\n') || '(none)'}`;
}

// Everything about this one person, newest facts last.
export function contextPrompt({ person: p, drafts = [], sent = [], instruction = '', now = new Date() }) {
  const ch = channelsOf(p);
  const due = p.task?.dueAt ? `due ${stamp(p.task.dueAt)}${new Date(p.task.dueAt) < now ? ' (overdue)' : ''}` : '';
  const out = [
    `Now: ${stamp(now)} (${now.toLocaleDateString('en', { weekday: 'long' })})`,
    `# Client\nName: ${p.name}${p.company ? `\nSource: ${p.company}` : ''}`
      + `\nPipeline stage: ${p.stage?.label || 'unknown'}`
      + (p.task ? `\nTask: ${[KIND[p.task.kind] || p.task.kind, p.task.rule, due].filter(Boolean).join(' · ')}` : '')
      + (p.task?.note ? `\nTask note: ${p.task.note}` : '')
      + `\nAvailable channels: ${Object.entries(ch).map(([k, v]) => `${k} (${v})`).join(', ')}`,
  ];
  const msgs = (p.messages || []).slice(-HISTORY);
  out.push(`# Conversation (last ${msgs.length}, oldest first)\n` +
    (msgs.map((m) => renderMessage(m, m.fromMe ? 'ME' : 'CLIENT')).join('\n\n') || '(no messages yet)'));
  if (sent.length) out.push(`# Sent by me since the last sync (not in the conversation above yet)\n` +
    sent.map((r) => renderMessage({ ...r, at: r.updatedAt }, 'ME')).join('\n\n'));
  if (drafts.length) out.push(`# Your earlier drafts for this client (not sent)\n` + drafts.map((r) => {
    const what = { pending: 'still waiting for approval', cancelled: 'cancelled by the user', regenerated: 'the user asked for a new version', done: 'meeting request: the user marked it done (meeting scheduled)' }[r.status];
    return `[${stamp(r.createdAt)} · ${r.kind === 'meeting' ? 'meeting request' : LABEL[r.channel]} · ${what}${r.note ? ` · reason: "${r.note}"` : ''}]\n${clip(r.text)}`;
  }).join('\n\n'));
  if (instruction) out.push(`# The user's instruction for this draft\n${instruction}`);
  out.push('Prepare the next step for this client now.');
  return out.join('\n\n');
}

export const draftSchema = (channels) => ({
  type: 'object', additionalProperties: false,
  required: ['action', 'channel', 'subject', 'text', 'templateId', 'reasoning'],
  properties: {
    action: { type: 'string', enum: ['message', 'meeting'] },
    channel: { type: 'string', enum: channels },
    subject: { type: 'string', description: 'Email subject; empty for WhatsApp and meetings' },
    text: { type: 'string', description: 'The message, or for a meeting a one-line brief of what to book' },
    templateId: { type: ['string', 'null'] },
    reasoning: { type: 'string' },
  },
});

// Turns Claude's answer into request fields, keeping only valid values.
export function toDraft(answer, channels, templates) {
  const channel = channels.includes(answer.channel) ? answer.channel : channels[0];
  return {
    kind: answer.action === 'meeting' ? 'meeting' : 'message', channel,
    subject: channel === 'email' && answer.action !== 'meeting' ? answer.subject.trim() : '',
    text: answer.text.trim(), reasoning: answer.reasoning.trim(),
    templateId: templates.some((t) => t.id === answer.templateId) ? answer.templateId : null,
  };
}

async function run(r, person, instruction) {
  try {
    const settings = getSettings(), templates = listTemplates(), channels = Object.keys(channelsOf(person));
    const answer = await askClaude({
      model: settings.model,
      system: systemPrompt(settings, templates),
      prompt: contextPrompt({
        person, instruction,
        drafts: store.unsentDrafts(person.id).filter((d) => d.id !== r.id),
        sent: store.sentSince(person.id, syncState().at),
      }),
      schema: draftSchema(channels),
    });
    // The user may have cancelled it while Claude was writing.
    if (store.getRequest(r.id).status === 'generating') store.updateRequest(r.id, { ...toDraft(answer, channels, templates), status: 'pending' });
  } catch (e) {
    if (store.getRequest(r.id).status === 'generating') store.updateRequest(r.id, { status: 'failed', error: e.message });
  }
}

// Starts drafts for these people in the background; skips anyone busy or
// unreachable. Returns the new requests.
export function draft(personIds, instruction = '') {
  const people = snapshotPeople(), out = [];
  for (const id of personIds) {
    const p = people.find((x) => x.id === id);
    if (!p || store.isBusy(id) || !Object.keys(channelsOf(p)).length) continue;
    for (const f of store.listRequests().filter((x) => x.personId === id && x.status === 'failed')) store.updateRequest(f.id, { status: 'cancelled' });
    const r = store.createRequest(p);
    run(r, p, instruction);
    out.push(r);
  }
  return out;
}

const closed = (r) => !r || !store.OPEN.includes(r.status);

export function regenerate(id, note = '') {
  const r = store.getRequest(id);
  if (closed(r)) return null;
  store.updateRequest(id, { status: r.status === 'failed' ? 'cancelled' : 'regenerated', note });
  return draft([r.personId], note)[0] ?? null;
}

export const cancel = (id, note = '') => (closed(store.getRequest(id)) ? null : store.updateRequest(id, { status: 'cancelled', note }));

// Email: sent over SMTP, as a reply to the last email. WhatsApp: opened in the
// app with the text filled in (the user presses send there). Meeting: done.
export async function approve(id, { text, subject } = {}) {
  const r = store.getRequest(id);
  if (!r || r.status !== 'pending') throw new Error('This request is no longer waiting');
  if (typeof text === 'string') r.text = text;
  if (typeof subject === 'string') r.subject = subject;
  if (r.kind === 'meeting') return store.updateRequest(id, { status: 'done' });
  const p = snapshotPeople().find((x) => x.id === r.personId);
  const to = p && channelsOf(p)[r.channel];
  if (!to) throw new Error(`No ${LABEL[r.channel]} contact for this person any more`);
  if (r.channel === 'email') {
    const last = p.messages.filter((m) => m.channel === 'email').at(-1);
    await sendEmail({ to, subject: r.subject || (last ? `Re: ${last.subject.replace(/^(re:\s*)+/i, '')}` : ''), text: r.text, inReplyTo: last?.messageId });
  } else await openWhatsApp(to, r.text);
  return store.updateRequest(id, { status: 'sent', text: r.text, subject: r.subject });
}

export const editRequest = (id, { text, subject }) => {
  const r = store.getRequest(id);
  if (!r || r.status !== 'pending') return null;
  return store.updateRequest(id, { ...(typeof text === 'string' && { text }), ...(typeof subject === 'string' && { subject }) });
};

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
