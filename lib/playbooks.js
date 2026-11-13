// Playbooks: a follow-up strategy per pipeline stage (and situation), up to
// MAX_STEPS steps (channel, wait, what we ask and why, template variants),
// branches for typical client responses, and lessons learned. In
// playbooks.json in the app data folder, with a log of every change so any
// change (the AI's or the user's) can be undone.
//
// Changes come as operations, the same shape the AI returns:
//   { op: 'setPlaybook', reason, playbook }   create or replace one playbook
//   { op: 'deletePlaybook', reason, id }
//   { op: 'setTemplate', reason, template: { id?, name, subject, body } }
//   { op: 'setStyle', reason, styleGuide }      the whole style guide (settings.json)
//   { op: 'setRule', reason, rule }             create or update a rule or fact (lib/rules.js)
//   { op: 'deleteRule', reason, id }
import { randomUUID } from 'node:crypto';
import { readData, writeData } from './cache.js';
import { events } from './events.js';
import { listTemplates, saveTemplate, deleteTemplate } from './templates.js';
import { getSettings, saveSettings } from './settings.js';
import { htmlToText } from '../public/resolve.js';
import { category } from './resultson.js';
import { getRule, putRule, cleanRule } from './rules.js';

export const MAX_STEPS = 10, MAX_RESPONSES = 12, MAX_LESSONS = 15;
export const CHANNELS = ['whatsapp', 'email', 'any'];
export const SITUATIONS = ['no-reply', 'conversation'];

let data;
// Stages as categories: playbooks saved (or undone to) before the categories
// changed name the former stages; they map onto the new ones.
const stagesOf = (xs) => uniq((Array.isArray(xs) ? xs : []).map(category).filter(Boolean));
const migrate = (p) => (p ? { ...p, stages: stagesOf(p.stages) } : p);
const load = () => {
  if (data) return data;
  data = readData('playbooks', { playbooks: [], changes: [] });
  data.playbooks = data.playbooks.map(migrate);
  return data;
};
const save = () => { writeData('playbooks', data); events.emit('playbooks', {}); };
export const resetCache = () => { data = undefined; };

export const listPlaybooks = () => load().playbooks;
export const listChanges = () => load().changes;
export const getPlaybook = (id) => load().playbooks.find((p) => p.id === id);

const str = (v, n = 2000) => String(v ?? '').trim().slice(0, n);
const slug = (s) => str(s, 60).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const uniq = (ids) => [...new Set(ids)];

// A clean playbook: known stages, channels and templates only, ids filled in, limits kept.
export function cleanPlaybook(p, templateIds) {
  const known = (ids) => uniq((Array.isArray(ids) ? ids : []).map(String).filter((id) => templateIds.has(id)));
  const id = slug(p.id || p.name) || randomUUID();
  const steps = (Array.isArray(p.steps) ? p.steps : []).slice(0, MAX_STEPS).map((s, i) => ({
    id: slug(s.id) || `step-${i + 1}`,
    channel: CHANNELS.includes(s.channel) ? s.channel : 'any',
    waitDays: Math.max(0, Math.min(90, Math.round(Number(s.waitDays) || 0))),
    ask: str(s.ask), why: str(s.why), templateIds: known(s.templateIds),
  }));
  const responses = (Array.isArray(p.responses) ? p.responses : []).slice(0, MAX_RESPONSES).map((r, i) => ({
    id: slug(r.id || r.when) || `response-${i + 1}`, when: str(r.when), approach: str(r.approach), templateIds: known(r.templateIds),
  }));
  return {
    id, name: str(p.name, 120) || id,
    stages: stagesOf(p.stages),
    situation: SITUATIONS.includes(p.situation) ? p.situation : 'no-reply',
    goal: str(p.goal),
    steps: dedupeIds(steps), responses: dedupeIds(responses),
    lessons: (Array.isArray(p.lessons) ? p.lessons : []).map((l) => str(l, 500)).filter(Boolean).slice(-MAX_LESSONS),
  };
}
function dedupeIds(items) {
  const seen = new Set();
  return items.map((x) => { let id = x.id, n = 2; while (seen.has(id)) id = `${x.id}-${n++}`; seen.add(id); return { ...x, id }; });
}

// Templates as the AI and the playbooks see them: plain text.
export const templateText = (t) => ({ id: t.id, name: t.name, subject: t.subject, body: htmlToText(t.bodyHtml) });
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const textToHtml = (s) => s.split('\n').map((l) => (l ? esc(l) : '<br>')).map((l) => `<div>${l}</div>`).join('');

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const findTemplate = (id) => listTemplates().find((t) => t.id === id) ?? null;
const stripDates = (t) => t && { id: t.id, name: t.name, subject: t.subject, bodyHtml: t.bodyHtml };
const styleGuide = () => getSettings().styleGuide;

// Applies operations as one logged change. trigger: { kind: 'build'|'batch'|
// 'distill'|'user'|'answer'|'migrate' (older: 'approve'|'regenerate'|'cancel'), count?, requestId?,
// personName?, note? }. Returns the change, or null when nothing changed.
// Rules from the AI's runs (build, batch, distill) can't claim the user's word (see cleanRule).
// merge: the user's edits to one item within MERGE_MS of their last edit to
// it fold into that change (autosave would otherwise log every pause).
const MERGE_MS = 10 * 60_000;
const AI_RUNS = ['build', 'batch', 'distill'];
export function applyOperations(operations, { trigger = { kind: 'user' }, summary = '', merge = false } = {}) {
  load();
  const done = [], ai = AI_RUNS.includes(trigger.kind);
  // Templates first, so steps can point at templates created in the same change.
  const order = (o) => (o.op === 'setTemplate' ? 0 : 1);
  for (const o of [...operations].sort((a, b) => order(a) - order(b))) {
    const reason = str(o.reason, 500);
    if (o.op === 'setTemplate' && o.template) {
      const t = o.template, before = t.id ? findTemplate(t.id) : null;
      const body = str(t.body, 8000);
      if (!body && !before) continue;
      const saved = saveTemplate(before?.id || slug(t.id) || '', {
        name: str(t.name, 120) || before?.name || 'AI template',
        subject: t.subject == null ? before?.subject ?? '' : str(t.subject, 300),
        bodyHtml: body ? textToHtml(body) : before.bodyHtml,
      });
      if (same(stripDates(before), stripDates(saved))) continue;
      done.push({ op: 'setTemplate', reason, id: saved.id, before: stripDates(before), after: stripDates(saved) });
    } else if (o.op === 'setPlaybook' && o.playbook) {
      const ids = new Set(listTemplates().map((t) => t.id));
      const after = cleanPlaybook(o.playbook, ids), before = getPlaybook(after.id) ?? null;
      if (same(before, after)) continue;
      setPb(after.id, after);
      done.push({ op: 'setPlaybook', reason, id: after.id, before, after });
    } else if (o.op === 'setStyle' && typeof o.styleGuide === 'string') {
      const before = styleGuide(), after = o.styleGuide.trim().slice(0, 40000);
      // A guide cut to under half is a truncated answer, not an edit.
      if (!after || after === before.trim() || after.length < before.trim().length / 2) continue;
      saveSettings({ styleGuide: after });
      done.push({ op: 'setStyle', reason, id: 'style', before, after });
    } else if (o.op === 'setRule' && o.rule) {
      const known = o.rule.id ? getRule(o.rule.id) ?? getRule(slug(o.rule.id)) : null;
      const before = known ?? null, after = cleanRule(o.rule, before, { ai, addEvidence: ai || trigger.kind === 'answer' });
      if (!after || (before && same({ ...before, updatedAt: 0 }, { ...after, updatedAt: 0 }))) continue;
      if (!before && getRule(after.id)) after.id = `${after.id}-${randomUUID().slice(0, 4)}`;
      putRule(after.id, after);
      done.push({ op: 'setRule', reason, id: after.id, before, after });
    } else if (o.op === 'deleteRule' && getRule(o.id)) {
      const before = getRule(o.id);
      // The AI may retire only its own guesses; the user's rules are theirs to remove.
      if (ai && before.source !== 'inferred') continue;
      putRule(o.id, null);
      done.push({ op: 'deleteRule', reason, id: o.id, before, after: null });
    } else if (o.op === 'deletePlaybook' && getPlaybook(o.id)) {
      done.push({ op: 'deletePlaybook', reason, id: o.id, before: getPlaybook(o.id), after: null });
      setPb(o.id, null);
    }
  }
  if (!done.length) return null;
  const last = data.changes.at(-1);
  if (merge && done.length === 1 && last && !last.undone && last.trigger.kind === 'user' && last.ops.length === 1
    && last.ops[0].op === done[0].op && last.ops[0].id === done[0].id && Date.now() - new Date(last.at) < MERGE_MS) {
    Object.assign(last, { at: new Date().toISOString(), summary: str(summary, 1000) || last.summary });
    last.ops[0].after = done[0].after;
    if (last.ops[0].op === 'setPlaybook' && same(last.ops[0].before, last.ops[0].after)) data.changes.pop(); // edited back
    save();
    return last;
  }
  const change = { id: randomUUID(), at: new Date().toISOString(), trigger, summary: str(summary, 1000), ops: done, undone: false };
  data.changes.push(change);
  save();
  return change;
}

function setPb(id, value) {
  const i = data.playbooks.findIndex((p) => p.id === id);
  value = migrate(value);
  if (value && i < 0) data.playbooks.push(value);
  else if (value) data.playbooks[i] = value;
  else if (i >= 0) data.playbooks.splice(i, 1);
}

// Undo puts every touched item back, but only if nothing changed it since.
export function undoChange(id) {
  load();
  const c = data.changes.find((x) => x.id === id);
  if (!c) return { error: 'Change not found' };
  if (c.undone) return { error: 'Already undone' };
  const current = (o) => (o.op === 'setTemplate' ? stripDates(findTemplate(o.id)) : o.op === 'setStyle' ? styleGuide()
    : o.op === 'setRule' || o.op === 'deleteRule' ? getRule(o.id) ?? null : getPlaybook(o.id) ?? null);
  if (c.ops.some((o) => !same(current(o), o.after))) return { error: 'Changed again since; undo the later change first' };
  for (const o of [...c.ops].reverse()) {
    if (o.op === 'setTemplate') {
      if (o.before) saveTemplate(o.id, o.before);
      else deleteTemplate(o.id);
    } else if (o.op === 'setStyle') saveSettings({ styleGuide: o.before });
    else if (o.op === 'setRule' || o.op === 'deleteRule') putRule(o.id, o.before);
    else setPb(o.id, o.before);
  }
  c.undone = true;
  save();
  return { change: c };
}

// Compact text for prompts: playbooks with their steps, branches and lessons.
export function renderPlaybooks(playbooks = listPlaybooks(), templates = listTemplates()) {
  const names = new Map(templates.map((t) => [t.id, t.name || 'Untitled']));
  const tpl = (ids) => (ids.length ? ` [templates: ${ids.map((id) => `${id} "${names.get(id)}"`).join(', ')}]` : '');
  return playbooks.map((p) => [
    `## ${p.id} · ${p.name}`,
    `Stages: ${p.stages.join(', ') || 'any'} · situation: ${p.situation}${p.goal ? `\nGoal: ${p.goal}` : ''}`,
    ...p.steps.map((s, i) => `${i + 1}. [${s.id}] ${s.channel}, after ${s.waitDays} day(s): ${s.ask}${s.why ? ` — why: ${s.why}` : ''}${tpl(s.templateIds)}`),
    ...(p.responses.length ? ['Responses:', ...p.responses.map((r) => `- [${r.id}] when ${r.when}: ${r.approach}${tpl(r.templateIds)}`)] : []),
    ...(p.lessons.length ? ['Lessons:', ...p.lessons.map((l) => `- ${l}`)] : []),
  ].join('\n')).join('\n\n');
}
