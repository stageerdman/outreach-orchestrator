// The playbook coach: builds the playbooks once from the templates, the
// user's real follow-up results and the style guide, then learns from the
// user's decisions on drafts (sent, edited, regenerated, cancelled, with the
// note). Each decision is saved as a lesson in lessons.json (app data folder);
// every BATCH lessons one run reviews them together. Each run returns
// operations (see lib/playbooks.js), applied as one logged, undoable change.
// Runs one at a time, in the background.
import { randomUUID } from 'node:crypto';
import { askClaude } from './claude.js';
import { readData, writeData } from './cache.js';
import { getSettings, prompts } from './settings.js';
import { listTemplates } from './templates.js';
import { listPlaybooks, applyOperations, templateText, MAX_STEPS, CHANNELS, SITUATIONS } from './playbooks.js';
import { STAGES } from './resultson.js';

const DAY = 864e5, TOUCH_GAP = 6 * 36e5;
const LABEL = { email: 'Email', whatsapp: 'WhatsApp' };
const clip = (s, n) => (s.length > n ? s.slice(0, n) + ' …' : s);

// ---- the answer: operations on playbooks and templates
const ids = { type: 'array', items: { type: 'string' } };
const PLAYBOOK = {
  type: 'object', additionalProperties: false,
  required: ['id', 'name', 'stages', 'situation', 'goal', 'steps', 'responses', 'lessons'],
  properties: {
    id: { type: 'string' }, name: { type: 'string' },
    stages: { type: 'array', items: { type: 'string', enum: STAGES } },
    situation: { type: 'string', enum: SITUATIONS }, goal: { type: 'string' },
    steps: { type: 'array', maxItems: MAX_STEPS, items: { type: 'object', additionalProperties: false, required: ['id', 'channel', 'waitDays', 'ask', 'why', 'templateIds'],
      properties: { id: { type: 'string' }, channel: { type: 'string', enum: CHANNELS }, waitDays: { type: 'number' }, ask: { type: 'string' }, why: { type: 'string' }, templateIds: ids } } },
    responses: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'when', 'approach', 'templateIds'],
      properties: { id: { type: 'string' }, when: { type: 'string' }, approach: { type: 'string' }, templateIds: ids } } },
    lessons: { type: 'array', items: { type: 'string' } },
  },
};
const TEMPLATE = { type: 'object', additionalProperties: false, required: ['id', 'name', 'subject', 'body'],
  properties: { id: { type: ['string', 'null'] }, name: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } } };
export const OPS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'operations'],
  properties: {
    summary: { type: 'string', description: 'One or two sentences for the user: what changed and why, or why nothing did' },
    operations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['op', 'reason', 'id', 'playbook', 'template', 'styleGuide'],
      properties: {
        op: { type: 'string', enum: ['setPlaybook', 'deletePlaybook', 'setTemplate', 'setStyle'] }, reason: { type: 'string' },
        id: { type: ['string', 'null'], description: 'For deletePlaybook' },
        playbook: { anyOf: [PLAYBOOK, { type: 'null' }] }, template: { anyOf: [TEMPLATE, { type: 'null' }] },
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
const EDITED = { approve: 'before sending', regenerate: 'before asking for a new version', cancel: 'before cancelling' };
export function learnInput(req, decision) {
  const edited = req.aiText != null && (req.aiText.trim() !== (req.text || '').trim() || (req.aiSubject ?? '') !== (req.subject ?? ''));
  const r = { ...req, text: clip(req.text || '', DRAFT_CLIP), aiText: clip(req.aiText ?? '', DRAFT_CLIP) };
  const ctx = r.context || { messages: [] };
  const tag = decision === 'approve' ? 'sent' : 'edited';
  const msgs = (ctx.messages || []).slice(-LESSON_MSGS).map((m) => ({ ...m, text: clip(m.text || '', LESSON_CLIP) }));
  return clip([
    `<decision kind="${decision}">\n${DECISION[decision]}${r.note ? `\nThe user's note: "${r.note}"` : decision === 'approve' ? '' : '\nNo note given.'}`
      + (edited ? `\nThe user edited the draft ${EDITED[decision]}. What the AI wrote:\n<ai>${r.aiSubject ? `Subject: ${r.aiSubject}\n` : ''}${r.aiText}</ai>\n${tag === 'sent' ? 'What was sent' : 'The user\'s version'}:\n<${tag}>${r.subject ? `Subject: ${r.subject}\n` : ''}${r.text}</${tag}>`
        : decision === 'approve' ? '\nSent as the AI wrote it.' : '') + '\n</decision>',
    `<draft kind="${r.kind}" channel="${r.channel}" playbook="${r.playbookId ?? ''}" step="${r.stepId ?? ''}" template="${r.templateId ?? ''}">\n`
      + `AI's reasoning: ${r.reasoning}\n${r.subject && !edited ? `Subject: ${r.subject}\n` : ''}${edited ? r.aiText : r.text}\n</draft>`,
    `<client stage="${ctx.stage || ''}">\nTask: ${ctx.task ? [ctx.task.kind, ctx.task.rule, ctx.task.note].filter(Boolean).join(' · ') : ''}\n`
      + `${ctx.followup ? `Messages sent since the client last wrote: ${ctx.followup.followups}\n` : ''}<conversation>\n${renderMsgs(msgs) || '(none)'}\n</conversation>\n</client>`,
  ].join('\n\n'), LESSON_MAX);
}

// A batch run: the current playbooks, templates and style guide, then the lessons in order.
export function batchInput(lessons, styleGuide = getSettings().styleGuide) {
  return [
    `<playbooks>\n${JSON.stringify(listPlaybooks(), null, 1)}\n</playbooks>`,
    `<templates>\n${renderTemplates(listTemplates())}\n</templates>`,
    `<style>\n${styleGuide.trim() || '(no style guide yet)'}\n</style>`,
    `<lessons count="${lessons.length}">\nThe user's decisions on drafts since the last review, oldest first.\n\n`
      + lessons.map((l, i) => `<lesson n="${i + 1}" at="${l.at.slice(0, 16).replace('T', ' ')}">\n${l.input}\n</lesson>`).join('\n\n') + '\n</lessons>',
  ].join('\n\n');
}

export function buildInput(people, styleGuide) {
  return [
    `<templates>\n${renderTemplates(listTemplates())}\n</templates>`,
    `<stats>\n${followupStats(people)}\n</stats>`,
    `<style>\n${clip(styleGuide || '(no style guide yet)', 12000)}\n</style>`,
    `<pipeline>\nStages, furthest first: ${STAGES.join(' > ')}.\n</pipeline>`,
    `<playbooks>\n${JSON.stringify(listPlaybooks(), null, 1)}\n</playbooks>`,
  ].join('\n\n');
}

// ---- lessons waiting for the next batch run
export const BATCH = 15;
export const listLessons = () => readData('lessons', []);
const saveLessons = (xs) => writeData('lessons', xs);

// ---- runs, one at a time
let chain = Promise.resolve();
let state = { running: false, queued: 0, building: false, learning: false, error: '', lastAt: null };
export const coachState = () => ({ ...state, lessons: listLessons().length, batch: BATCH });

function enqueue(job) {
  state = { ...state, queued: state.queued + 1 };
  chain = chain.then(async () => {
    state = { ...state, queued: state.queued - 1, running: true };
    try { await job(); state = { ...state, error: '' }; }
    catch (e) { state = { ...state, error: e.message }; console.error('coach:', e.message); }
    finally { state = { ...state, running: false, lastAt: new Date().toISOString() }; }
  });
  return coachState();
}

async function ask(system, prompt, timeout) {
  const s = getSettings();
  return askClaude({ model: s.model, system, prompt, schema: OPS_SCHEMA, timeout });
}

// After a decision on a draft (r: the request with its context): saved as a
// lesson; the BATCH-th starts a run (also a retry after a failed one).
export function learnFrom(r, decision) {
  if (!r || !DECISION[decision] || (decision !== 'approve' && !r.text)) return coachState();
  const lessons = [...listLessons(), { id: randomUUID(), requestId: r.id, kind: decision, personName: r.personName,
    note: r.note || '', at: new Date().toISOString(), input: learnInput(r, decision) }];
  saveLessons(lessons);
  return lessons.length >= BATCH ? learnNow() : coachState();
}

// One run over every waiting lesson; on success exactly those are removed.
export function learnNow() {
  const lessons = listLessons();
  if (state.learning || !lessons.length) return coachState();
  state = { ...state, learning: true };
  return enqueue(async () => {
    try {
      const { summary, operations } = await ask(prompts().coach, batchInput(lessons), 10 * 60_000);
      applyOperations(operations, { trigger: { kind: 'batch', count: lessons.length, notes: lessons.filter((l) => l.note).length }, summary });
      const done = new Set(lessons.map((l) => l.id));
      saveLessons(listLessons().filter((l) => !done.has(l.id)));
    } finally { state = { ...state, learning: false }; }
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
