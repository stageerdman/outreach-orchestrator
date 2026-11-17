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
import { listRules, renderRules } from './rules.js';
import { renderMind, mindIds } from './mind.js';
import { connectionsForAI, renderConnections } from './connections.js';
import { logConnection } from './connlog.js';
import { followupState, scenarioOf, renderScenario, scenarioSummary } from './scenario.js';

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

// The follow-up position lives with the scenario (lib/scenario.js).
export { followupState };
export const renderFollowup = (f) => (!f.clientEverWrote && !f.followups ? 'No messages yet: first contact.'
  : (f.followups ? `${f.followups} message(s) sent since the client last wrote (${f.channels.join(' → ')}), the last ${f.daysSinceMine} day(s) ago.` : 'The client wrote last; nothing sent since.')
    + (f.clientEverWrote ? ` The client last wrote ${f.daysSinceClient} day(s) ago.` : ' The client has never written.'));

// What the AI saw for a draft, kept with it: the user's later decision on the
// draft (sent, cancelled with a reason) plus this is training data.
const toContextMessage = ({ channel, id, at, fromMe, from, subject, text }) => ({ channel, id, at, fromMe, from, subject, text: clip(text || '') });
export const contextOf = (p, now = new Date(), scenario = scenarioOf(p, listPlaybooks(), now)) => ({ stage: p.stage?.label || '', task: p.task || null,
  followup: followupState(p.messages, now), scenario: scenarioSummary(scenario), messages: (p.messages || []).slice(-HISTORY).map(toContextMessage) });

// Stable across a batch (good for prompt caching): instructions, style, templates.
const PLAYBOOK_HOW = `Our follow-up strategy, all of it. The scenario at the top of the client's context already says which playbook and step (or reply branches) apply: follow that. These are here so you know the whole sequence and what comes next. Set "playbookId" and "stepId" (a step or response id) to what you followed, or null.`;

const FACTS_HOW = `True about the offer; never contradict them.`;
const MIND_HOW = `A portrait of how the user thinks, distilled from their own conversations and their corrections of earlier drafts. It is judgment, not a script: read this client through it to decide whether to send now or wait, whether to ask or to offer, and what the user would refuse to do. The playbook scenario says what to send and which template; the portrait may justify a deviation from it only when it clearly applies here, and then say so in "reasoning". The tensions tell you which way the user leans when. Put the ids of the portrait items (and facts) you relied on in "ruleIds".`;
export function systemPrompt(settings, templates, playbooks = listPlaybooks(), rules = listRules(), mind = renderMind()) {
  const style = settings.styleGuide.trim() || '(No style guide yet: write briefly, friendly and professional, like the user\'s earlier messages.)';
  const tpls = templates.map((t) => `## ${t.id} · ${t.name || 'Untitled'}\n${t.subject ? `Subject: ${t.subject}\n` : ''}${htmlToText(t.bodyHtml)}`);
  const pbs = playbooks.length ? `\n\n# Playbooks\n${PLAYBOOK_HOW}\n\n${renderPlaybooks(playbooks, templates)}` : '';
  const rs = renderRules(rules.filter((r) => r.kind === 'fact'));
  return `${prompts(settings).draft}${mind ? `\n\n# How the user thinks\n${MIND_HOW}\n\n${mind}` : ''}${rs ? `\n\n# Facts\n${FACTS_HOW}\n\n${rs}` : ''}${pbs}\n\n# Style guide\n${style}\n\n# Templates\n${tpls.join('\n\n') || '(none)'}`;
}

// The versions this draft replaces (previousId back to the first), oldest first.
const MAX_REVISIONS = 10;
export function revisionsOf(r, get = store.getRequest) {
  const out = [];
  for (let x = r.previousId && get(r.previousId); x && out.length < MAX_REVISIONS; x = x.previousId && get(x.previousId)) out.unshift(x);
  return out;
}

// One earlier version: what the user asked for, what the AI wrote, the user's edit.
const asked = (t) => (t?.trim() ? `The user asked: "${t.trim()}"` : 'The user gave no instruction.');
function renderRevision(r, i) {
  const ai = r.aiText ?? r.text, subj = (s) => (s ? `Subject: ${s}\n` : '');
  const what = r.kind === 'meeting' ? 'meeting request' : LABEL[r.channel] || 'message';
  const edited = r.aiText != null && (r.aiText.trim() !== r.text.trim() || (r.aiSubject ?? '') !== (r.subject ?? ''));
  return [`## Version ${i + 1} (${stamp(r.createdAt)})`, asked(r.instruction), `You wrote (${what}):\n${subj(r.aiSubject ?? r.subject)}${clip(ai || '')}`,
    edited && `The user edited it to:\n${subj(r.subject)}${clip(r.text)}`].filter(Boolean).join('\n');
}

// Everything about this one person, newest facts last. revisions: the earlier
// versions of this draft (a regenerate), so every note so far is remembered.
function clientBlock(p, now, onWa) {
  const ch = channelsOf(p, onWa);
  const noWa = p.phones.length && !p.phones.some(onWa);
  const due = p.task?.dueAt ? `due ${stamp(p.task.dueAt)}${new Date(p.task.dueAt) < now ? ' (overdue)' : ''}` : '';
  return `# Client\nName: ${p.name}${p.company ? `\nSource: ${p.company}` : ''}`
    + `\nCategory (stage): ${p.stage?.label || 'unknown'}`
    + (p.task ? `\nTask: ${[KIND[p.task.kind] || p.task.kind, p.task.rule, due].filter(Boolean).join(' · ')}` : '')
    + (p.task?.note ? `\nTask note: ${p.task.note}` : '')
    + `\nFollow-up position: ${renderFollowup(followupState(p.messages, now))}`
    + `\nAvailable channels: ${Object.entries(ch).map(([k, v]) => `${k} (${v})`).join(', ')}`
    + (noWa ? `\nWhatsApp: ${p.phones.join(', ')} was not found on WhatsApp (probably no account)${ch.whatsapp ? '; use it only if there is no other way' : ''}.` : '');
}

// connections: what each connection gave the AI for this client (connectionsForAI).
export function contextPrompt({ person: p, drafts = [], sent = [], instruction = '', revisions = [], connections = [], now = new Date(), onWa = whatsappKnown,
  scenario = scenarioOf(p, listPlaybooks(), now), templates = listTemplates() }) {
  const out = [
    `Now: ${stamp(now)} (${now.toLocaleDateString('en', { weekday: 'long', timeZone: TZ })}). All times here are Prague time (Europe/Prague); any time you or the client mention means Prague time.`,
    ...(scenario ? [renderScenario(scenario, templates)] : []),
    clientBlock(p, now, onWa),
  ];
  const conns = renderConnections(connections);
  if (conns) out.push(conns);
  const msgs = (p.messages || []).slice(-HISTORY);
  out.push(`# Conversation (last ${msgs.length}, oldest first)\n` +
    (msgs.map((m) => renderMessage(m, m.fromMe ? 'ME' : 'CLIENT')).join('\n\n') || '(no messages yet)'));
  if (sent.length) out.push(`# Sent by me since the last sync (not in the conversation above yet)\n` +
    sent.map((r) => renderMessage({ ...r, at: r.updatedAt }, 'ME')).join('\n\n'));
  const inChain = new Set(revisions.map((r) => r.id));
  drafts = drafts.filter((r) => !inChain.has(r.id));
  if (drafts.length) out.push(`# Your earlier drafts for this client (not sent)\n` + drafts.map((r) => {
    const what = { pending: 'still waiting for approval', cancelled: 'cancelled by the user', regenerated: 'the user asked for a new version', done: 'meeting request: the user offered the client a meeting (an activity done, not a meeting booked; the conversation and stage show whether it got booked)' }[r.status];
    const edited = r.aiText != null && r.aiText.trim() !== r.text.trim() ? ' · the user edited it: this is their version' : '';
    return `[${stamp(r.createdAt)} · ${r.kind === 'meeting' ? 'meeting request' : LABEL[r.channel]} · ${what}${edited}${r.note ? ` · reason: "${r.note}"` : ''}]\n${clip(r.text)}`;
  }).join('\n\n'));
  if (revisions.length) {
    const n = revisions.length + 1;
    out.push(`# Revisions of this draft (oldest first; you are writing version ${n})\n${revisions.map(renderRevision).join('\n\n')}`
      + `\n\n## Version ${n} (now)\n${asked(instruction)}\nKeep everything the user asked for in every version above, not only the last note; where they edited your text, start from their version; don't repeat anything they corrected.`);
  } else if (instruction) out.push(`# The user's instruction for this draft\n${instruction}`);
  out.push('Prepare the next step for this client now.');
  return out.join('\n\n');
}

// Gathers what every connection gives the AI for this client and logs, per
// connection, exactly the part of the prompt that came from it (Connections view).
export async function gatherConnections(p, purpose, now = new Date(), onWa = whatsappKnown) {
  const connections = await connectionsForAI(p);
  const msgs = (p.messages || []).slice(-HISTORY);
  for (const c of connections) {
    const text = c.id === 'crm' ? clientBlock(p, now, onWa)
      : c.id === 'whatsapp' || c.id === 'email' ? msgs.filter((m) => m.channel === c.id).map((m) => renderMessage(m, m.fromMe ? 'ME' : 'CLIENT')).join('\n\n') || '(no messages)'
      : c.text || '(not set up: nothing given)';
    try { logConnection(c.id, 'toAI', { person: p.name, purpose, text }); } catch (e) { console.error('connlog:', e.message); }
  }
  return connections;
}

export const draftSchema = (channels) => ({
  type: 'object', additionalProperties: false,
  required: ['action', 'channel', 'subject', 'text', 'templateId', 'playbookId', 'stepId', 'ruleIds', 'reasoning'],
  properties: {
    action: { type: 'string', enum: ['message', 'meeting'] },
    channel: { type: 'string', enum: channels },
    subject: { type: 'string', description: 'Email subject; empty for WhatsApp and meetings' },
    text: { type: 'string', description: 'The message, or for a meeting a one-line brief of what to book' },
    templateId: { type: ['string', 'null'] },
    playbookId: { type: ['string', 'null'] },
    stepId: { type: ['string', 'null'], description: 'The playbook step or response id followed' },
    ruleIds: { type: 'array', items: { type: 'string' }, description: 'Ids of the portrait items and facts you relied on' },
    reasoning: { type: 'string' },
  },
});

// Turns Claude's answer into request fields, keeping only valid values.
export function toDraft(answer, channels, templates, playbooks = [], rules = []) {
  const known = new Set([...rules.filter((x) => x.kind === 'fact' && x.status !== 'rejected').map((x) => x.id), ...mindIds()]);
  const channel = channels.includes(answer.channel) ? answer.channel : channels[0];
  const pb = playbooks.find((p) => p.id === answer.playbookId);
  const stepId = pb && [...pb.steps, ...pb.responses].some((x) => x.id === answer.stepId) ? answer.stepId : null;
  return {
    kind: answer.action === 'meeting' ? 'meeting' : 'message', channel,
    subject: channel === 'email' && answer.action !== 'meeting' ? answer.subject.trim() : '',
    text: answer.text.trim(), reasoning: answer.reasoning.trim(),
    templateId: templates.some((t) => t.id === answer.templateId) ? answer.templateId : null,
    playbookId: pb?.id ?? null, stepId,
    ruleIds: [...new Set((answer.ruleIds || []).filter((x) => known.has(x)))],
  };
}

async function run(r, person, instruction, scenario) {
  try {
    const settings = getSettings(), templates = listTemplates(), playbooks = listPlaybooks(), rules = listRules(), channels = draftChannels(person, r.channel);
    const answer = await askClaude({
      model: settings.model,
      system: systemPrompt(settings, templates, playbooks, rules),
      prompt: contextPrompt({
        person, instruction, scenario, templates, revisions: revisionsOf(r), connections: await gatherConnections(person, 'draft'),
        drafts: store.unsentDrafts(person.id).filter((d) => d.id !== r.id),
        sent: store.sentSince(person.id, syncState().at, undefined, person.messages),
      }),
      schema: draftSchema(channels),
    });
    // The user may have cancelled it while Claude was writing.
    if (store.getRequest(r.id).status === 'generating') {
      const d = toDraft(answer, channels, templates, playbooks, rules);
      store.updateRequest(r.id, { ...d, aiText: d.text, aiSubject: d.subject, status: 'pending' });
    }
  } catch (e) {
    if (store.getRequest(r.id).status === 'generating') store.updateRequest(r.id, { status: 'failed', error: e.message });
  }
}

// Starts drafts for these people in the background; skips anyone busy or
// unreachable. Returns the new requests. channel: only this one (if the person
// has it); previousId: the draft this one replaces (a regenerate).
// templateId: draft from this template (the AI is told so; the request shows it while generating).
export function draft(personIds, instruction = '', { channel = null, previousId = null, templateId = null } = {}) {
  if (templateId) instruction = [`Use template ${templateId}.`, instruction].filter(Boolean).join(' ');
  const people = snapshotPeople(), out = [];
  for (const id of personIds) {
    const p = people.find((x) => x.id === id);
    if (!p || store.isBusy(id) || !Object.keys(channelsOf(p)).length) continue;
    for (const f of store.listRequests().filter((x) => x.personId === id && x.status === 'failed')) store.updateRequest(f.id, { status: 'cancelled' });
    const chs = draftChannels(p, channel), now = new Date(), scenario = scenarioOf(p, listPlaybooks(), now);
    const r = store.createRequest(p, contextOf(p, now, scenario), { channel: chs.length === 1 ? chs[0] : null, instruction, previousId, templateId, scenario: scenarioSummary(scenario) });
    run(r, p, instruction, scenario);
    out.push(r);
  }
  return out;
}

const closed = (r) => !r || !store.OPEN.includes(r.status);

export function regenerate(id, note = '', channel = null) {
  const r = store.getRequest(id);
  if (closed(r)) return null;
  store.updateRequest(id, { status: r.status === 'failed' ? 'cancelled' : 'regenerated', note });
  if (r.status === 'pending') learnFrom(lessonOf(id), 'regenerate');
  return draft([r.personId], note, { channel, previousId: id })[0] ?? null;
}

// Cancelling a written draft is a lesson for the playbooks.
export function cancel(id, note = '') {
  const r = store.getRequest(id);
  if (closed(r)) return null;
  const wasDraft = r.status === 'pending';
  const out = store.updateRequest(id, { status: 'cancelled', note });
  if (wasDraft) learnFrom(lessonOf(id), 'cancel');
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

// A draft made in the Copilot chat: without a note of its own, the user's chat
// messages along its chain (the instructions) are the note for the lesson.
export function lessonOf(id) {
  const r = requestWithContext(id);
  if (!r || r.note?.trim()) return r;
  const asks = [...revisionsOf(r), r].filter((x) => x.via === 'copilot' && x.instruction?.trim()).map((x) => x.instruction.trim());
  return asks.length ? { ...r, note: asks.join(' / ') } : r;
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
    learnFrom(lessonOf(id), 'approve');
    return out;
  }
  const p = snapshotPeople().find((x) => x.id === r.personId);
  const to = p && (r.channel === 'email' ? p.emails[0] : p.phones[0]);
  if (!to) throw new Error(`No ${LABEL[r.channel]} contact for this person any more`);
  if (r.channel === 'email') {
    const last = p.messages.filter((m) => m.channel === 'email').at(-1);
    r.messageId = (await sendEmail({ to, subject: r.subject || replySubject(p.messages), text: r.text, inReplyTo: last?.messageId }))?.messageId;
  } else await openWhatsApp(to, r.text);
  try { logConnection(r.channel, 'out', { person: p.name, purpose: 'send', to, subject: r.channel === 'email' ? r.subject || replySubject(p.messages) : undefined,
    text: r.text, ...(r.channel === 'whatsapp' && { note: 'Opened in WhatsApp with this text filled in; you press send there.' }) }); } catch (e) { console.error('connlog:', e.message); }
  const out = store.updateRequest(id, { status: 'sent', text: r.text, subject: r.subject, ...(r.messageId && { messageId: r.messageId }) });
  learnFrom(lessonOf(id), 'approve');
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
