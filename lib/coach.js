// The playbook coach: builds the playbooks once from the templates, the
// user's real follow-up results and the style guide, then learns from every
// decision on a draft (sent, regenerated, cancelled, with the user's note).
// Each run returns operations (see lib/playbooks.js), applied as one logged,
// undoable change. Runs one at a time, in the background.
import { askClaude } from './claude.js';
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
    operations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['op', 'reason', 'id', 'playbook', 'template'],
      properties: {
        op: { type: 'string', enum: ['setPlaybook', 'deletePlaybook', 'setTemplate'] }, reason: { type: 'string' },
        id: { type: ['string', 'null'], description: 'For deletePlaybook' },
        playbook: { anyOf: [PLAYBOOK, { type: 'null' }] }, template: { anyOf: [TEMPLATE, { type: 'null' }] },
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

export function learnInput(r, decision) {
  const ctx = r.context || { messages: [] };
  const edited = decision === 'approve' && r.aiText != null && (r.aiText.trim() !== r.text.trim() || (r.aiSubject ?? '') !== (r.subject ?? ''));
  return [
    `<decision kind="${decision}">\n${DECISION[decision]}${r.note ? `\nThe user's note: "${r.note}"` : decision === 'approve' ? '' : '\nNo note given.'}`
      + (edited ? `\nThe user edited the draft before sending. What the AI wrote:\n<ai>${r.aiSubject ? `Subject: ${r.aiSubject}\n` : ''}${r.aiText}</ai>\nWhat was sent:\n<sent>${r.subject ? `Subject: ${r.subject}\n` : ''}${r.text}</sent>`
        : decision === 'approve' ? '\nSent as the AI wrote it.' : '') + '\n</decision>',
    `<draft kind="${r.kind}" channel="${r.channel}" playbook="${r.playbookId ?? ''}" step="${r.stepId ?? ''}" template="${r.templateId ?? ''}">\n`
      + `AI's reasoning: ${r.reasoning}\n${r.subject && !edited ? `Subject: ${r.subject}\n` : ''}${edited ? r.aiText : r.text}\n</draft>`,
    `<client stage="${ctx.stage || ''}">\nTask: ${ctx.task ? [ctx.task.kind, ctx.task.rule, ctx.task.note].filter(Boolean).join(' · ') : ''}\n`
      + `${ctx.followup ? `Messages sent since the client last wrote: ${ctx.followup.followups}\n` : ''}<conversation>\n${renderMsgs(ctx.messages || []) || '(none)'}\n</conversation>\n</client>`,
    `<playbooks>\n${JSON.stringify(listPlaybooks(), null, 1)}\n</playbooks>`,
    `<templates>\n${renderTemplates(listTemplates())}\n</templates>`,
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

// ---- runs, one at a time
let chain = Promise.resolve();
let state = { running: false, queued: 0, building: false, error: '', lastAt: null };
export const coachState = () => state;

function enqueue(job) {
  state = { ...state, queued: state.queued + 1 };
  chain = chain.then(async () => {
    state = { ...state, queued: state.queued - 1, running: true };
    try { await job(); state = { ...state, error: '' }; }
    catch (e) { state = { ...state, error: e.message }; console.error('coach:', e.message); }
    finally { state = { ...state, running: false, lastAt: new Date().toISOString() }; }
  });
  return state;
}

async function ask(system, prompt, timeout) {
  const s = getSettings();
  return askClaude({ model: s.model, system, prompt, schema: OPS_SCHEMA, timeout });
}

// After a decision on a draft (r: the request with its context).
export function learnFrom(r, decision) {
  if (!r || !DECISION[decision] || (decision !== 'approve' && !r.text)) return state;
  const trigger = { kind: decision, requestId: r.id, personName: r.personName, note: r.note || '' };
  return enqueue(async () => {
    const { summary, operations } = await ask(prompts().coach, learnInput(r, decision));
    applyOperations(operations, { trigger, summary });
  });
}

// Builds (or rebuilds) all playbooks.
export function buildPlaybooks(people, styleGuide) {
  if (state.building) return state;
  state = { ...state, building: true };
  return enqueue(async () => {
    try {
      const { summary, operations } = await ask(prompts().build, buildInput(people, styleGuide), 20 * 60_000);
      applyOperations(operations, { trigger: { kind: 'build' }, summary });
    } finally { state = { ...state, building: false }; }
  });
}
