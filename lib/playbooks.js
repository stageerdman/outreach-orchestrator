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
import { randomUUID } from 'node:crypto';
import { readData, writeData } from './cache.js';
import { listTemplates, saveTemplate, deleteTemplate } from './templates.js';
import { htmlToText } from '../public/resolve.js';
import { STAGES } from './resultson.js';

export const MAX_STEPS = 10, MAX_RESPONSES = 12, MAX_LESSONS = 15;
export const CHANNELS = ['whatsapp', 'email', 'any'];
export const SITUATIONS = ['no-reply', 'conversation'];

let data;
const load = () => (data ??= readData('playbooks', { playbooks: [], changes: [] }));
const save = () => writeData('playbooks', data);
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
    stages: uniq((Array.isArray(p.stages) ? p.stages : []).filter((s) => STAGES.includes(s))),
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

// Applies operations as one logged change. trigger: { kind: 'build'|'approve'|
// 'regenerate'|'cancel'|'user', requestId?, personName?, note? }. Returns the
// change, or null when nothing changed.
export function applyOperations(operations, { trigger = { kind: 'user' }, summary = '' } = {}) {
  load();
  const done = [];
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
    } else if (o.op === 'deletePlaybook' && getPlaybook(o.id)) {
      done.push({ op: 'deletePlaybook', reason, id: o.id, before: getPlaybook(o.id), after: null });
      setPb(o.id, null);
    }
  }
  if (!done.length) return null;
  const change = { id: randomUUID(), at: new Date().toISOString(), trigger, summary: str(summary, 1000), ops: done, undone: false };
  data.changes.push(change);
  save();
  return change;
}

function setPb(id, value) {
  const i = data.playbooks.findIndex((p) => p.id === id);
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
  const current = (o) => (o.op === 'setTemplate' ? stripDates(findTemplate(o.id)) : getPlaybook(o.id) ?? null);
  if (c.ops.some((o) => !same(current(o), o.after))) return { error: 'Changed again since; undo the later change first' };
  for (const o of [...c.ops].reverse()) {
    if (o.op === 'setTemplate') {
      if (o.before) saveTemplate(o.id, o.before);
      else deleteTemplate(o.id);
    } else setPb(o.id, o.before);
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
