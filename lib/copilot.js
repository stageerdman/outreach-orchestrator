// The Copilot: per person, a chat with the AI that drafts their messages. The
// user talks the next message through; the AI answers and can act: write or
// rewrite the draft in front of the user, change a playbook / template / the
// style guide / a fact (logged, undoable), or remember how the user thinks
// (a mind note). Each turn is one stateless `claude -p` run (stream-json, so
// its thinking and reply stream in), with the same context a draft gets plus
// the current draft and this chat so far (the scenario is in contextPrompt).
// Transcript in copilot.json (app data): { [personId]: { items: [{ id, kind:
// user|ai|action|error, text, thinking?, actions?, stopped?, ok?, type?,
// requestId?, changeId?, at }] } }, the last MAX_ITEMS per person.
// Events (SSE `copilot`): { personId, running, item? } on every transcript
// change; { personId, id, thinking, reply, running: true } while a turn streams
// (id = the ai item it becomes).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readData, writeData, dataDir } from './cache.js';
import { events } from './events.js';
import * as store from './requests.js';
import { snapshotPeople, syncState } from './sync.js';
import { getSettings } from './settings.js';
import { listTemplates } from './templates.js';
import { listPlaybooks, getPlaybook, applyOperations } from './playbooks.js';
import { listRules } from './rules.js';
import { addNote } from './mind.js';
import { OPS_SCHEMA } from './coach.js';
import { availabilityText } from './calendar.js';
import { scenarioOf, scenarioSummary } from './scenario.js';
import { systemPrompt, contextPrompt, contextOf, draftChannels, toDraft, revisionsOf, replySubject } from './assistant.js';

const BIN = process.env.CLAUDE_BIN || 'claude';
const MAX = 2, TIMEOUT = 5 * 60_000, MAX_ITEMS = 60, PROMPT_ITEMS = 24, CLIP = 800, THROTTLE = 100;
const clip = (s = '', n = CLIP) => (s.length > n ? s.slice(0, n) + ' …' : s);
const short = (s = '', n = 120) => clip(String(s).replace(/\s+/g, ' ').trim(), n);

export const COPILOT_PROMPT = `# Copilot
Right now you are not writing a draft on your own: the user is chatting with you, the AI that drafts their messages, about this one client's next message. The draft in front of them (if any), the scenario and this chat so far are in the user message; their newest message is last.
- Do what they ask. When they want the message changed (shorter, another angle, other channel, a template), return a "draft" action with the complete new text; it replaces the draft they see. Keep everything they asked for earlier in this chat and their own edits.
- When they state a general way of doing things ("from now on…", "always…", "never…", "with people like this…"), change the playbook (setPlaybook: return the whole playbook, complete, same id and the ids of steps and responses you keep; change the right step, branch or its templates), a template (setTemplate) or, for wording habits, the style guide (setStyle: the whole guide with small edits). A fact about the offer: setRule (kind fact).
- When they describe how they think or decide (what they notice, why they do something, what matters to them), "remember" it: one or two sentences in their sense, in English.
- When a correction might be general but they didn't say so, ask in one line whether to make it the rule for this stage. Don't change playbooks, templates or the style guide silently.
- Never invent facts. No client names or personal details in playbooks, templates, the style guide, facts or what you remember.
- "thinking": your reasoning for the user to see, plain English, short (1–3 sentences). "reply": to the user, short, in the language of their newest message (Czech or English; not the client's language); say plainly what you changed. "actions": usually none or one; [] when you only answer or ask.
- Every action has every field; fill those its type uses, null the rest.`;

// ---- the answer: thinking (streams first), reply, actions
const opsItem = OPS_SCHEMA.properties.operations.items.properties;
const nullable = (s) => ({ anyOf: [s.anyOf ? s.anyOf[0] : s, { type: 'null' }] });
const RULE = opsItem.rule.anyOf[0];
const FACT = { ...RULE, properties: { ...RULE.properties, kind: { type: 'string', enum: ['fact'] } } };
export const TYPES = ['draft', 'setPlaybook', 'setTemplate', 'setStyle', 'setRule', 'remember'];
const str = { type: ['string', 'null'] };
export const copilotSchema = (channels) => ({
  type: 'object', additionalProperties: false, required: ['thinking', 'reply', 'actions'],
  properties: {
    thinking: { type: 'string' }, reply: { type: 'string' },
    actions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['type', 'reason', 'channel', 'subject', 'text', 'templateId', 'playbookId', 'stepId', 'reasoning', 'playbook', 'template', 'styleGuide', 'rule'],
      properties: {
        type: { type: 'string', enum: TYPES },
        reason: { ...str, description: 'For playbook/template/style/fact changes: why, in one line' },
        channel: { type: ['string', 'null'], enum: [...channels, null], description: 'draft' },
        subject: { ...str, description: 'draft: email subject; empty for WhatsApp' },
        text: { ...str, description: 'draft: the whole message; remember: what to remember' },
        templateId: str, playbookId: str, stepId: str,
        reasoning: { ...str, description: 'draft: why this message, one sentence' },
        playbook: nullable(opsItem.playbook), template: nullable(opsItem.template),
        styleGuide: { ...str, description: 'setStyle: the complete new style guide' },
        rule: nullable(FACT),
      } } },
  },
});

export const copilotArgs = ({ system, schema, model }) => [
  '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
  '--tools', '', '--strict-mcp-config', '--no-session-persistence',
  '--system-prompt', system, '--json-schema', JSON.stringify(schema), ...(model ? ['--model', model] : []),
];

// The current value of a top-level string field in JSON that may be cut off
// anywhere (mid-string, mid-escape): '' until the field starts.
export function partialString(json, key) {
  const m = new RegExp(`[{,]\\s*"${key}"\\s*:\\s*"`).exec(json);
  if (!m) return '';
  let out = '';
  const ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const c = json[i];
    if (c === '"') return out;
    if (c !== '\\') { out += c; continue; }
    const e = json[i + 1];
    if (e === undefined) break;
    if (e === 'u') {
      const hex = json.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16)); i += 5;
    } else { out += ESC[e] ?? e; i++; }
  }
  return out.replace(/[\uD800-\uDBFF]$/, ''); // half of a pair still on the way
}

// ---- transcript
let all;
const load = () => (all ??= readData('copilot', {}));
const convo = (personId) => (load()[personId] ??= { items: [] });
const turns = new Map(); // personId → { id, child?, stopped }
export const isRunning = (personId) => turns.has(personId);
const emit = (personId, extra = {}) => events.emit('copilot', { personId, running: isRunning(personId), ...extra });
function add(personId, kind, text, extra = {}) {
  const c = convo(personId), item = { id: randomUUID(), kind, text, ...extra, at: new Date().toISOString() };
  c.items = [...c.items, item].slice(-MAX_ITEMS);
  writeData('copilot', load());
  emit(personId, { item });
  return item;
}
export const getCopilot = (personId) => ({ items: load()[personId]?.items ?? [], running: isRunning(personId) });

// ---- the prompt
const LABEL = { email: 'Email', whatsapp: 'WhatsApp' };
const openDraft = (personId) => store.listRequests().find((r) => r.personId === personId && store.BUSY.includes(r.status));
function renderDraft(r) {
  if (!r) return '# The draft in front of the user\n(none yet)';
  if (r.status === 'generating') return '# The draft in front of the user\nA draft is being written right now; it can\'t be changed until it\'s done.';
  const edited = r.aiText != null && (r.aiText.trim() !== r.text.trim() || (r.aiSubject ?? '') !== (r.subject ?? ''));
  const meta = [r.kind === 'meeting' ? 'meeting request' : LABEL[r.channel], edited ? 'edited by the user: this is their version' : 'as you wrote it',
    r.templateId && `template ${r.templateId}`, r.playbookId && `playbook ${r.playbookId}${r.stepId ? ` / ${r.stepId}` : ''}`].filter(Boolean).join(' · ');
  return `# The draft in front of the user\n[${meta}]\n${r.subject ? `Subject: ${r.subject}\n` : ''}${clip(r.text, 3000)}`;
}
const WHO = { user: 'USER', ai: 'YOU', action: 'DONE', error: 'ERROR' };
const renderChat = (items) => items.slice(-PROMPT_ITEMS).map((i) => `${WHO[i.kind]}: ${clip(i.text || '')}`).join('\n');

function turnInput(person, text, items) {
  const settings = getSettings(), templates = listTemplates(), playbooks = listPlaybooks(), rules = listRules();
  const channels = draftChannels(person), draft = openDraft(person.id), now = new Date(), scenario = scenarioOf(person, playbooks, now);
  return availabilityText().then((availability) => {
    const context = contextPrompt({ person, availability, now, scenario, templates, revisions: draft ? revisionsOf(draft) : [],
      drafts: store.unsentDrafts(person.id).filter((d) => d.id !== draft?.id), sent: store.sentSince(person.id, syncState().at, undefined, person.messages) })
      .replace(/\n\nPrepare the next step for this client now\.$/, '');
    const prompt = [context, renderDraft(draft),
      items.length ? `# This chat so far (oldest first)\n${renderChat(items)}` : '', `# The user's new message\n${text}`, `Write "thinking" in English and "reply" in ${langOf(text)}.`].filter(Boolean).join('\n\n');
    return { system: `${systemPrompt(settings, templates, playbooks, rules)}\n\n${COPILOT_PROMPT}`, prompt,
      schema: copilotSchema(channels), model: settings.model, ctx: { channels, templates, playbooks, rules, scenario, now } };
  });
}

// The language the user wrote in (the reply's), not the client's.
export const langOf = (t) => (/[ěščřžůťďň]|\b(je|to|se|na|ať|jak|proč|udělej|zkrať|napiš|prosím|ne|ano)\b/i.test(t) ? 'Czech' : 'English');

// ---- actions
const fail = (type, text) => ({ type, ok: false, text });
export function applyAction(a, person, userText, ctx) {
  const who = { trigger: { kind: 'copilot', personName: person.name } };
  const why = short(a.reason || '', 200);
  if (a.type === 'draft') {
    const open = openDraft(person.id);
    if (open?.status === 'generating') return fail('draft', 'A draft is still being written; left it as it is');
    if (!ctx.channels.length) return fail('draft', 'No channel to write to this person');
    const d = toDraft({ action: 'message', channel: a.channel, subject: a.subject ?? '', text: a.text ?? '', templateId: a.templateId,
      playbookId: a.playbookId, stepId: a.stepId, ruleIds: [], reasoning: a.reasoning ?? '' }, ctx.channels, ctx.templates, ctx.playbooks, ctx.rules);
    if (!d.text) return fail('draft', 'The draft came back empty');
    // A rewrite of the draft there keeps what it followed unless the AI says otherwise.
    if (!d.templateId && open?.templateId && !a.templateId) Object.assign(d, { templateId: open.templateId, playbookId: d.playbookId ?? open.playbookId ?? null, stepId: d.stepId ?? open.stepId ?? null });
    if (d.channel === 'email' && !d.subject) d.subject = replySubject(person.messages);
    if (open) store.updateRequest(open.id, { status: 'regenerated', note: userText, via: 'copilot' });
    const r = store.createRequest(person, contextOf(person, ctx.now, ctx.scenario), { ...d, aiText: d.text, aiSubject: d.subject, status: 'pending',
      instruction: userText, previousId: open?.id ?? null, via: 'copilot', scenario: scenarioSummary(ctx.scenario) });
    return { type: 'draft', ok: true, requestId: r.id, previousId: open?.id ?? null, text: open ? 'Draft updated' : 'Draft written' };
  }
  if (a.type === 'remember') {
    const note = addNote(a.text, { source: 'copilot' });
    return note ? { type: 'remember', ok: true, noteAt: note.at, text: `Remembered: “${short(note.text)}”` } : fail('remember', 'Nothing to remember');
  }
  const op = a.type === 'setPlaybook' ? a.playbook && { op: 'setPlaybook', reason: why, playbook: a.playbook }
    : a.type === 'setTemplate' ? a.template && { op: 'setTemplate', reason: why, template: a.template }
    : a.type === 'setStyle' ? a.styleGuide && { op: 'setStyle', reason: why, styleGuide: a.styleGuide }
    : a.type === 'setRule' ? a.rule && { op: 'setRule', reason: why, rule: { ...a.rule, kind: 'fact' } } : null;
  if (!op) return fail(a.type, 'Nothing to change');
  const before = op.op === 'setPlaybook' ? getPlaybook(op.playbook.id) : null;
  const line = op.op === 'setPlaybook' ? `Playbook '${before?.name || op.playbook.name}' ${before ? 'changed' : 'added'}`
    : op.op === 'setTemplate' ? `Template '${op.template.name}' saved` : op.op === 'setStyle' ? 'Style guide changed' : `Fact saved: ${short(op.rule.text, 80)}`;
  const change = applyOperations([op], { ...who, summary: `${line}${why ? `: ${why}` : ''}` });
  return change ? { type: a.type, ok: true, changeId: change.id, text: change.summary } : fail(a.type, `${line.split(':')[0]}: nothing changed`);
}

// ---- turns: one at a time per person, at most MAX at once overall
let active = 0;
const queue = [];
function next() {
  while (active < MAX && queue.length) {
    const job = queue.shift();
    active++;
    job().finally(() => { active--; next(); });
  }
}

// The user's message; resolves when the turn ends. Throws (status 409) while one runs.
export function say(personId, text) {
  text = String(text ?? '').trim();
  const person = snapshotPeople().find((p) => p.id === personId);
  if (!person) throw Object.assign(new Error('Person not found'), { status: 404 });
  if (!text) throw Object.assign(new Error('Nothing to send'), { status: 400 });
  if (isRunning(personId)) throw Object.assign(new Error('Still working on the last message'), { status: 409 });
  const before = convo(personId).items;
  const turn = { id: randomUUID(), stopped: false };
  turns.set(personId, turn);
  add(personId, 'user', text);
  return new Promise((resolve) => {
    turn.job = () => runTurn(person, text, before, turn).catch((e) => add(person.id, 'error', short(e.message, 300)))
      .finally(() => { turns.delete(personId); emit(personId); resolve(); });
    queue.push(turn.job);
    next();
  });
}

async function runTurn(person, text, items, turn) {
  if (turn.stopped) return add(person.id, 'error', 'Stopped.');
  const { system, prompt, schema, model, ctx } = await turnInput(person, text, items);
  if (turn.stopped) return add(person.id, 'error', 'Stopped.');
  const out = await new Promise((resolve) => {
    const p = turn.child = spawn(BIN, copilotArgs({ system, schema, model }), { cwd: dataDir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', err = '', partial = '', result = null, shown = { thinking: '', reply: '' }, timer = null, last = 0;
    const killer = setTimeout(() => { turn.timedOut = true; p.kill(); }, TIMEOUT);
    const flush = () => {
      timer = null; last = Date.now();
      const now = { thinking: partialString(partial, 'thinking'), reply: partialString(partial, 'reply') };
      if (now.thinking === shown.thinking && now.reply === shown.reply) return;
      shown = now;
      events.emit('copilot', { personId: person.id, id: turn.id, ...now, running: true });
    };
    const onEvent = (e) => {
      const d = e.type === 'stream_event' && e.event?.type === 'content_block_delta' ? e.event.delta : null;
      if (d?.type === 'input_json_delta') {
        partial += d.partial_json ?? '';
        if (!timer) timer = setTimeout(flush, Math.max(0, THROTTLE - (Date.now() - last)));
      } else if (e.type === 'stream_event' && e.event?.type === 'message_start') partial = ''; // a retry starts over
      else if (e.type === 'result') result = e;
    };
    p.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { onEvent(JSON.parse(line)); } catch { /* not JSON */ }
      }
    });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { err = e.code === 'ENOENT' ? `Claude Code not found (${BIN}); set CLAUDE_BIN` : e.message; });
    p.on('close', (code) => {
      clearTimeout(killer); clearTimeout(timer); flush();
      resolve({ code, err, result, partial: { thinking: partialString(partial, 'thinking'), reply: partialString(partial, 'reply') } });
    });
    p.stdin.end(prompt);
  });
  if (turn.stopped || turn.timedOut) {
    const { thinking, reply } = out.partial, msg = turn.timedOut ? 'Stopped after 5 minutes.' : 'Stopped.';
    return thinking || reply ? add(person.id, 'ai', reply || '', { id: turn.id, thinking, stopped: true }) : add(person.id, 'error', msg);
  }
  const r = out.result, answer = r && !r.is_error ? r.structured_output ?? tryJSON(r.result) : null;
  if (!answer || typeof answer.reply !== 'string') {
    return add(person.id, 'error', short(r?.is_error ? r.result || r.subtype || 'Claude failed' : out.err.trim() || `Claude returned nothing${out.code ? ` (${out.code})` : ''}`, 300));
  }
  const actions = (Array.isArray(answer.actions) ? answer.actions : []).filter((a) => TYPES.includes(a?.type)).map((a) => {
    try { return applyAction(a, person, text, ctx); } catch (e) { return fail(a.type, short(e.message, 200)); }
  });
  add(person.id, 'ai', answer.reply.trim(), { id: turn.id, thinking: String(answer.thinking ?? '').trim(), actions });
  for (const { text: line, ...rest } of actions) add(person.id, 'action', line, rest);
}
const tryJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };

export function stop(personId) {
  const t = turns.get(personId);
  if (!t) return false;
  t.stopped = true;
  const i = queue.indexOf(t.job);
  if (i >= 0) { queue.splice(i, 1); t.job(); } // still waiting for a slot: ends at once
  else t.child?.kill('SIGTERM');
  return true;
}

// A new conversation with this person's copilot.
export function clear(personId) {
  if (isRunning(personId)) throw Object.assign(new Error('Stop it first'), { status: 409 });
  delete load()[personId];
  writeData('copilot', load());
  emit(personId, { cleared: true });
  return getCopilot(personId);
}
