// The playbook coach: builds the playbooks once from the templates, the
// user's real follow-up results and the style guide, then learns from the
// user's decisions on drafts (sent, edited, regenerated, cancelled, with the
// note). Each decision is saved as a lesson in lessons.json (app data folder);
// a lesson with a note or an edit starts a run after QUIET (a later one resets
// it); plain sends and cancels wait for BATCH. A run reviews every waiting
// lesson together and accounts for each note and edit ("handled"), kept in
// learnlog.json (the last LOG_MAX runs) for the user to see. Each run returns
// operations (see lib/playbooks.js), applied as one logged, undoable change.
// Runs one at a time, in the background.
// The same runs keep the facts about the offer (lib/rules.js, kind "fact");
// how the user thinks is the portrait (lib/mind.js), not rules.
import { randomUUID } from 'node:crypto';
import { askClaude } from './claude.js';
import { readData, writeData } from './cache.js';
import { events } from './events.js';
import { getSettings, prompts } from './settings.js';
import { listTemplates } from './templates.js';
import { listPlaybooks, applyOperations, templateText, MAX_STEPS, CHANNELS, SITUATIONS } from './playbooks.js';
import { STAGES, LEGACY } from './resultson.js';
import { rulesForCoach, isMigrated, setMigrated, KINDS, QUESTION_KINDS, EFFECTS } from './rules.js';
import { listRequests } from './requests.js';

const DAY = 864e5, TOUCH_GAP = 6 * 36e5;
const LABEL = { email: 'Email', whatsapp: 'WhatsApp' };
const clip = (s, n) => (s.length > n ? s.slice(0, n) + ' …' : s);

// ---- the answer: operations on playbooks and templates
const ids = { type: 'array', items: { type: 'string' } };
export const PLAYBOOK = {
  type: 'object', additionalProperties: false,
  required: ['id', 'name', 'stages', 'situation', 'goal', 'steps', 'responses'],
  properties: {
    id: { type: 'string' }, name: { type: 'string' },
    stages: { type: 'array', items: { type: 'string', enum: STAGES } },
    situation: { type: 'string', enum: SITUATIONS }, goal: { type: 'string' },
    steps: { type: 'array', maxItems: MAX_STEPS, items: { type: 'object', additionalProperties: false, required: ['id', 'channel', 'waitDays', 'ask', 'why', 'templateIds'],
      properties: { id: { type: 'string' }, channel: { type: 'string', enum: CHANNELS }, waitDays: { type: 'number' }, ask: { type: 'string' }, why: { type: 'string' }, templateIds: ids } } },
    responses: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'when', 'approach', 'templateIds'],
      properties: { id: { type: 'string' }, when: { type: 'string' }, approach: { type: 'string' }, templateIds: ids } } },
  },
};
export const RULE = {
  type: 'object', additionalProperties: false, required: ['id', 'kind', 'when', 'text', 'because', 'stages', 'evidence', 'fromAnswer'],
  properties: {
    id: { type: ['string', 'null'], description: 'An existing rule id to update it; a new short slug to create one' },
    kind: { type: 'string', enum: KINDS }, when: { type: 'string', description: "The situation in the client's terms; empty for facts and rules that always hold" },
    text: { type: 'string', description: 'How the user thinks or acts toward the client, never about wording, channel or timing of a message (or, for a fact, the fact)' },
    because: { type: 'string', description: "The belief behind it, from the user's own words; else empty" },
    stages: { type: 'array', items: { type: 'string', enum: STAGES } },
    evidence: { type: 'array', description: 'New evidence from these lessons only', items: { type: 'object', additionalProperties: false, required: ['for', 'text'],
      properties: { for: { type: 'boolean' }, text: { type: 'string', description: 'One anonymised line: the case and what the user did' } } } },
    fromAnswer: { type: 'boolean', description: "True only for a new rule taken from the user's own answer to a question" },
  },
};
const QUESTION = {
  type: 'object', additionalProperties: false, required: ['kind', 'ruleId', 'prompt', 'case', 'options'],
  properties: {
    kind: { type: 'string', enum: QUESTION_KINDS }, ruleId: { type: ['string', 'null'] },
    prompt: { type: 'string' }, case: { type: 'string' },
    options: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'text', 'effect'],
      properties: { label: { type: 'string' }, text: { type: 'string' }, effect: { type: 'string', enum: EFFECTS } } } },
  },
};
export const TEMPLATE = { type: 'object', additionalProperties: false, required: ['id', 'name', 'subject', 'body'],
  properties: { id: { type: ['string', 'null'] }, name: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } } };
export const OUTCOMES = ['changed', 'situational', 'already', 'style'];
const HANDLED = { type: 'object', additionalProperties: false, required: ['lesson', 'outcome', 'what'],
  properties: { lesson: { type: 'number', description: 'The lesson n' }, outcome: { type: 'string', enum: OUTCOMES },
    what: { type: 'string', description: 'One plain English sentence: the change, named (playbook, step, what it does now), or why nothing changed (for situational: what makes it specific to this one client)' } } };
export const OPS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'operations', 'questions', 'handled'],
  properties: {
    summary: { type: 'string', description: 'One or two sentences for the user: what changed and why, or why nothing did' },
    handled: { type: 'array', description: 'One entry for every lesson with a note or an edit', items: HANDLED },
    questions: { type: 'array', items: QUESTION, description: 'Questions for the user; usually none' },
    operations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['op', 'reason', 'id', 'playbook', 'template', 'styleGuide', 'rule'],
      properties: {
        op: { type: 'string', enum: ['setPlaybook', 'deletePlaybook', 'setTemplate', 'setStyle', 'setRule', 'deleteRule'] }, reason: { type: 'string' },
        id: { type: ['string', 'null'], description: 'For deletePlaybook and deleteRule' },
        playbook: { anyOf: [PLAYBOOK, { type: 'null' }] }, template: { anyOf: [TEMPLATE, { type: 'null' }] },
        rule: { anyOf: [RULE, { type: 'null' }] },
        styleGuide: { type: ['string', 'null'], description: 'For setStyle: the complete new style guide, i.e. the current one with small, specific edits; same structure' },
      } } },
  },
};

// ---- what the user's real follow-ups achieved (aggregates for the build)
// For each touch (my messages less than 6 hours apart count once), numbered
// since the client last wrote: did the client write back within 7 days of it,
// before my next touch?
export function followupStats(people) {
  const rows = [];
  for (const p of people) {
    let n = 0, touch = null;
    for (const m of p.messages || []) {
      if (!m.fromMe) {
        // A reply counts for my last touch before it only.
        if (touch && new Date(m.at) - new Date(touch.at) <= 7 * DAY) touch.replied = true;
        n = 0; touch = null;
      } else if (touch && new Date(m.at) - new Date(touch.last) <= TOUCH_GAP) touch.last = m.at;
      else rows.push(touch = { n: ++n, at: m.at, last: m.at, channel: m.channel, stage: p.stage?.label || '', replied: false });
    }
  }
  const rate = (xs) => `${xs.filter((r) => r.replied).length}/${xs.length} (${xs.length ? Math.round((100 * xs.filter((r) => r.replied).length) / xs.length) : 0}%)`;
  const by = (key) => Object.entries(Object.groupBy(rows, key)).map(([k, xs]) => `- ${k}: ${rate(xs)}`).join('\n');
  return `My messages (touches) and whether the client wrote back within 7 days (replied/sent). Touch 1 = first message after the client's last message (or first contact); 2+ = follow-ups without a reply.\nAll: ${rate(rows)}\n`
    + `By touch number:\n${by((r) => (r.n >= 6 ? '6+' : String(r.n)))}\nBy channel:\n${by((r) => LABEL[r.channel])}\nBy current stage:\n${by((r) => r.stage || 'unknown')}`;
}

// ---- prompt inputs
const renderTemplates = (templates) => templates.map(templateText)
  .map((t) => `<template id="${t.id}" name="${t.name}"${t.subject ? ` subject="${t.subject}"` : ''}>\n${t.body}\n</template>`).join('\n');
const renderMsgs = (msgs) => msgs.map((m) => `[${m.at.slice(0, 16).replace('T', ' ')} · ${LABEL[m.channel]} · ${m.fromMe ? 'ME' : 'CLIENT'}]${m.subject ? ` Subject: ${m.subject}` : ''}\n${m.text}`).join('\n\n');
const DECISION = {
  approve: 'The user approved and sent this draft.', regenerate: 'The user rejected this draft and asked for a new version.',
  cancel: 'The user cancelled this draft (nothing was sent).',
};

// One decision as a lesson, rendered when it happens (later state doesn't
// change it): the decision, the draft (what the AI wrote vs. the user's
// version when edited) and the client's recent conversation. Bounded.
const LESSON_MSGS = 12, LESSON_CLIP = 600, DRAFT_CLIP = 3000, LESSON_MAX = 12000;
// The distill run reads many past decisions at once: shorter.
export const COMPACT = { msgs: 6, clip: 300, draft: 1200, max: 5000 };
const EDITED = { approve: 'before sending', regenerate: 'before asking for a new version', cancel: 'before cancelling' };
export function learnInput(req, decision, { msgs: nMsgs = LESSON_MSGS, clip: msgClip = LESSON_CLIP, draft = DRAFT_CLIP, max = LESSON_MAX } = {}) {
  const edited = req.aiText != null && (req.aiText.trim() !== (req.text || '').trim() || (req.aiSubject ?? '') !== (req.subject ?? ''));
  const r = { ...req, text: clip(req.text || '', draft), aiText: clip(req.aiText ?? '', draft) };
  const ctx = r.context || { messages: [] };
  const tag = decision === 'approve' ? 'sent' : 'edited';
  const msgs = (ctx.messages || []).slice(-nMsgs).map((m) => ({ ...m, text: clip(m.text || '', msgClip) }));
  return clip([
    `<decision kind="${decision}">\n${DECISION[decision]}${r.note ? `\nThe user's note: "${r.note}"` : decision === 'approve' ? '' : '\nNo note given.'}`
      + (edited ? `\nThe user edited the draft ${EDITED[decision]}. What the AI wrote:\n<ai>${r.aiSubject ? `Subject: ${r.aiSubject}\n` : ''}${r.aiText}</ai>\n${tag === 'sent' ? 'What was sent' : 'The user\'s version'}:\n<${tag}>${r.subject ? `Subject: ${r.subject}\n` : ''}${r.text}</${tag}>`
        : decision === 'approve' ? '\nSent as the AI wrote it.' : '') + '\n</decision>',
    `<draft kind="${r.kind}" channel="${r.channel}" playbook="${r.playbookId ?? ''}" step="${r.stepId ?? ''}" template="${r.templateId ?? ''}" rules="${(r.ruleIds || []).join(' ')}">\n`
      + `AI's reasoning: ${r.reasoning}\n${r.subject && !edited ? `Subject: ${r.subject}\n` : ''}${edited ? r.aiText : r.text}\n</draft>`,
    `<client stage="${ctx.stage || ''}">\nTask: ${ctx.task ? [ctx.task.kind, ctx.task.rule, ctx.task.note].filter(Boolean).join(' · ') : ''}\n`
      + `${ctx.followup ? `Messages sent since the client last wrote: ${ctx.followup.followups}\n` : ''}<conversation>\n${renderMsgs(msgs) || '(none)'}\n</conversation>\n</client>`,
  ].join('\n\n'), max);
}

// The categories, and what the former stage names (in older lessons and drafts) mean now.
export const pipelineText = () => `<pipeline>\nThe client's category (stage), furthest first: ${STAGES.join(' > ')}. Use only these names.\n`
  + `Older lessons, drafts or playbooks may name former stages; they now are: ${Object.entries(LEGACY).map(([a, b]) => `${a} = ${b}`).join(', ')}.\n</pipeline>`;

// A batch run: the current playbooks, templates and style guide, then the lessons in order.
// Facts about the offer (how the user thinks lives in the portrait, lib/mind.js).
const rulesInput = () => `<rules>\n${JSON.stringify(rulesForCoach().filter((r) => r.kind === 'fact'), null, 1)}\n</rules>`;
const strong = (l) => Boolean(l.note || l.edited);
export function batchInput(lessons, styleGuide = getSettings().styleGuide) {
  const must = lessons.map((l, i) => (strong(l) ? i + 1 : 0)).filter(Boolean);
  return [
    `<playbooks>\n${JSON.stringify(listPlaybooks(), null, 1)}\n</playbooks>`,
    rulesInput(),
    `<templates>\n${renderTemplates(listTemplates())}\n</templates>`,
    `<style>\n${styleGuide.trim() || '(no style guide yet)'}\n</style>`,
    pipelineText(),
    `<lessons count="${lessons.length}">\nThe user's decisions on drafts since the last review, oldest first.\n\n`
      + lessons.map((l, i) => `<lesson n="${i + 1}" at="${l.at.slice(0, 16).replace('T', ' ')}">\n${l.input}\n</lesson>`).join('\n\n') + '\n</lessons>',
    must.length ? `Lessons with a note or an edit (instructions; one "handled" entry each): ${must.join(', ')}.` : 'No lesson has a note or an edit: "handled" is empty.',
  ].join('\n\n');
}

export function buildInput(people, styleGuide) {
  return [
    `<templates>\n${renderTemplates(listTemplates())}\n</templates>`,
    `<stats>\n${followupStats(people)}\n</stats>`,
    `<style>\n${clip(styleGuide || '(no style guide yet)', 12000)}\n</style>`,
    pipelineText(),
    `<playbooks>\n${JSON.stringify(listPlaybooks(), null, 1)}\n</playbooks>`,
    rulesInput(),
  ].join('\n\n');
}

// ---- lessons waiting for the next run
export const BATCH = 15, QUIET = 3 * 60_000, LOG_MAX = 50, INPUT_CLIP = 4000;
export const listLessons = () => readData('lessons', []);
const saveLessons = (xs) => writeData('lessons', xs);

// ---- the learning log: what each run did with each note and edit, newest first
export const listLearnLog = () => readData('learnlog', []).toReversed();
const saveLog = (xs) => writeData('learnlog', xs.slice(-LOG_MAX));

// Lesson numbers back to the lessons; every note or edit gets an entry (one the
// coach skipped says so).
export function logEntry(lessons, { summary, handled = [] }, { trigger, changeId = null, at = new Date().toISOString(), id = randomUUID() }) {
  const by = new Map();
  for (const h of handled) {
    const n = Math.round(Number(h.lesson));
    if (n >= 1 && n <= lessons.length && !by.has(n)) by.set(n, h);
  }
  lessons.forEach((l, i) => { if (strong(l) && !by.has(i + 1)) by.set(i + 1, { outcome: 'unanswered', what: 'The coach gave no account of this one.' }); });
  return { id, at, trigger, count: lessons.length, summary, changeId,
    handled: [...by].sort((a, b) => a[0] - b[0]).map(([n, h]) => {
      const l = lessons[n - 1];
      return { id: randomUUID(), lesson: n, outcome: OUTCOMES.includes(h.outcome) ? h.outcome : 'unanswered', what: String(h.what || '').trim(),
        note: l.note || '', edited: Boolean(l.edited), personName: l.personName || '', decision: l.kind, requestId: l.requestId ?? null, input: clip(l.input || '', INPUT_CLIP) };
    }) };
}

// ---- runs, one at a time
let chain = Promise.resolve();
// last: the latest learning run { count, summary, changed }.
let state = { running: false, queued: 0, building: false, learning: false, error: '', lastAt: null, last: null };
export const coachState = () => ({ ...state, lessons: listLessons().length, batch: BATCH, quietAt: quiet.at, log: listLearnLog().slice(0, 10) });
// SSE `playbooks`: the coach's state or its log changed (the playbooks' own changes emit it too).
const changed = () => events.emit('playbooks', {});

function enqueue(job) {
  state = { ...state, queued: state.queued + 1 };
  chain = chain.then(async () => {
    state = { ...state, queued: state.queued - 1, running: true };
    changed();
    try { await job(); state = { ...state, error: '' }; }
    catch (e) { state = { ...state, error: e.message }; console.error('coach:', e.message); }
    finally { state = { ...state, running: false, lastAt: new Date().toISOString() }; changed(); }
  });
  changed();
  return coachState();
}

async function ask(system, prompt, timeout) {
  const s = getSettings();
  return askClaude({ model: s.model, system, prompt, schema: OPS_SCHEMA, timeout });
}

// What a new lesson starts: a run now (BATCH reached), a run after the quiet
// period (it has a note or an edit), or nothing yet.
export const whenToLearn = (lessons, lesson) => (lessons.length >= BATCH ? 'batch' : strong(lesson) ? 'quiet' : null);

// The quiet period: a timer, reset by every noted or edited lesson. ms is settable for tests.
const quiet = { timer: null, at: null, ms: QUIET };
export const setQuiet = (ms) => { quiet.ms = ms; };
function startQuiet() {
  clearTimeout(quiet.timer);
  quiet.at = new Date(Date.now() + quiet.ms).toISOString();
  quiet.timer = setTimeout(() => { quiet.timer = quiet.at = null; learnNow('quiet'); }, quiet.ms);
  quiet.timer.unref?.();
}
const stopQuiet = () => { clearTimeout(quiet.timer); quiet.timer = quiet.at = null; };

const edited = (r) => r.aiText != null && (r.aiText.trim() !== (r.text || '').trim() || (r.aiSubject ?? '') !== (r.subject ?? ''));

// After a decision on a draft (r: the request with its context): saved as a
// lesson; see whenToLearn (BATCH also retries after a failed run).
export function learnFrom(r, decision) {
  if (!r || !DECISION[decision] || (decision !== 'approve' && !r.text)) return coachState();
  const lesson = { id: randomUUID(), requestId: r.id, kind: decision, personName: r.personName,
    note: r.note || '', edited: edited(r), at: new Date().toISOString(), input: learnInput(r, decision) };
  const lessons = [...listLessons(), lesson];
  saveLessons(lessons);
  const when = whenToLearn(lessons, lesson);
  if (when === 'batch') return learnNow('batch');
  if (when === 'quiet') startQuiet();
  changed();
  return coachState();
}

// One coach run over these lessons; logged; onDone(entry) after it is applied.
async function review(lessons, trigger, extra = {}) {
  const answer = await ask(prompts().coach, batchInput(lessons), 10 * 60_000);
  const ops = answer.operations.filter((o) => (o.op !== 'setRule' || o.rule?.kind === 'fact') && o.op !== 'deleteRule');
  const change = applyOperations(ops, { trigger: { kind: 'batch', count: lessons.length, notes: lessons.filter((l) => l.note).length, ...extra }, summary: answer.summary });
  const entry = logEntry(lessons, answer, { trigger, changeId: change?.id ?? null });
  saveLog([...readData('learnlog', []), entry]);
  state = { ...state, last: { at: entry.at, count: lessons.length, summary: answer.summary, changed: Boolean(change) } };
  return entry;
}

// One run over every waiting lesson; on success exactly those are removed.
// trigger: 'now' (the user), 'batch' or 'quiet'.
export function learnNow(trigger = 'now') {
  const lessons = listLessons();
  if (state.learning || !lessons.length) return coachState();
  stopQuiet();
  state = { ...state, learning: true };
  return enqueue(async () => {
    try {
      await review(lessons, trigger);
      const done = new Set(lessons.map((l) => l.id));
      saveLessons(listLessons().filter((l) => !done.has(l.id)));
    } finally {
      state = { ...state, learning: false };
      // Notes that came in during the run get their own quiet period.
      if (!quiet.timer && listLessons().some((l) => !lessons.some((x) => x.id === l.id) && strong(l))) startQuiet();
    }
  });
}

export const GENERAL = 'The user says this applies generally, not just to this client: turn it into a playbook/template/style change.';

// The user says a note marked situational holds generally: one more run over
// that lesson alone, logged as its own run (trigger 'general'); the original
// entry points at it.
export function makeGeneral(runId, entryId) {
  const run = readData('learnlog', []).find((x) => x.id === runId), h = run?.handled.find((x) => x.id === entryId);
  if (!h) throw Object.assign(new Error('Not in the learning log'), { status: 404 });
  if (h.generalizedBy) throw Object.assign(new Error('Already sent back as general'), { status: 409 });
  const lesson = { id: randomUUID(), requestId: h.requestId, kind: h.decision, personName: h.personName, note: h.note, edited: h.edited,
    at: new Date().toISOString(), input: `${h.input}\n\n${GENERAL}` };
  return enqueue(async () => {
    const entry = await review([{ ...lesson, note: lesson.note || GENERAL }], 'general', { general: true });
    const log = readData('learnlog', []), orig = log.find((x) => x.id === runId)?.handled.find((x) => x.id === entryId);
    if (orig) orig.generalizedBy = entry.id;
    saveLog(log);
  });
}

// Builds (or rebuilds) all playbooks.
export function buildPlaybooks(people, styleGuide) {
  if (state.building) return coachState();
  state = { ...state, building: true };
  return enqueue(async () => {
    try {
      const { summary, operations } = await ask(prompts().build, buildInput(people, styleGuide), 20 * 60_000);
      applyOperations(operations, { trigger: { kind: 'build' }, summary });
    } finally { state = { ...state, building: false }; }
  });
}

const OUTCOME = { sent: 'Sent it', done: 'Sent it', regenerated: 'Asked for another version', cancelled: 'Cancelled it' };

// How often the user sends a draft as the AI wrote it, per week (Monday, Prague):
// sent unchanged / all decided (sent, regenerated, cancelled).
const pragueDay = (iso) => new Date(iso).toLocaleDateString('sv', { timeZone: 'Europe/Prague' });
export function fidelity(list = listRequests(), weeks = 8) {
  const out = new Map();
  for (const r of list) {
    if (!OUTCOME[r.status]) continue;
    const d = new Date(`${pragueDay(r.updatedAt || r.createdAt)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const w = d.toISOString().slice(0, 10), x = out.get(w) ?? { week: w, decided: 0, asIs: 0 };
    x.decided++;
    if ((r.status === 'sent' || r.status === 'done') && !edited(r) && (r.aiSubject ?? r.subject ?? '') === (r.subject ?? '')) x.asIs++;
    out.set(w, x);
  }
  return [...out.values()].sort((a, b) => b.week.localeCompare(a.week)).slice(0, weeks);
}

// ---- once: the playbooks' lessons become rules (scoped to the playbook's stages)
export function migrateLessons() {
  if (isMigrated()) return null;
  const ops = [];
  for (const p of listPlaybooks()) {
    if (!p.lessons?.length) continue;
    p.lessons.forEach((l, i) => ops.push({ op: 'setRule', reason: `From the playbook "${p.name}"`,
      rule: { id: `${p.id}-${i + 1}`, kind: 'rule', when: p.situation === 'no-reply' ? 'the client stopped replying' : 'in a conversation', text: l, because: '', stages: p.stages, status: 'active', source: 'inferred' } }));
    ops.push({ op: 'setPlaybook', reason: 'Lessons moved to Personalization', playbook: { ...p, lessons: [] } });
  }
  const change = ops.length ? applyOperations(ops, { trigger: { kind: 'migrate' }, summary: 'Moved the playbooks\' lessons into your rules (Personalization)' }) : null;
  setMigrated();
  return change;
}
