// How the user thinks: decision rules ("when <situation>, <what you do>,
// because <your reason>") and facts about the product, each with its evidence
// (decisions and answers for and against) and where it came from; plus the
// AI's open questions to the user that test them. In rules.json in the app
// data folder. Rules change only through operations (lib/playbooks.js
// applyOperations: setRule / deleteRule), so every change is logged and
// undoable; questions are kept here. Method: the PERSONALIZATION update.
import { randomUUID } from 'node:crypto';
import { readData, writeData } from './cache.js';
import { category } from './resultson.js';
import { events } from './events.js';

export const KINDS = ['rule', 'fact'];
export const STATUSES = ['testing', 'active', 'rejected'];
export const SOURCES = ['inferred', 'confirmed', 'stated'];
export const QUESTION_KINDS = ['ab', 'confirm', 'scenario'];
export const EFFECTS = ['confirm', 'reject', 'depends', 'none'];
// An inferred rule is used as active once this many decisions support it and none contradict it.
export const ACTIVE_SUPPORT = 4;
export const MAX_RULES = 80, MAX_EVIDENCE = 12, MAX_OPEN = 3;
const DAY = 864e5, BATCH_GAP = 20 * 36e5;

let data;
const load = () => (data ??= { rules: [], questions: [], migrated: false, ...readData('rules', {}) });
const save = () => { writeData('rules', data); events.emit('personal', {}); };
export const resetCache = () => { data = undefined; };

export const listRules = () => load().rules;
export const getRule = (id) => load().rules.find((r) => r.id === id);
// Raw put (null removes); used by applyOperations and its undo only.
export function putRule(id, value) {
  const rules = load().rules, i = rules.findIndex((r) => r.id === id);
  if (value && i < 0) rules.push(value);
  else if (value) rules[i] = value;
  else if (i >= 0) rules.splice(i, 1);
  save();
}
export const isMigrated = () => load().migrated;
export const setMigrated = () => { load().migrated = true; save(); };

const str = (v, n = 1000) => String(v ?? '').trim().slice(0, n);
const slug = (s) => str(s, 60).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pick = (v, xs, d) => (xs.includes(v) ? v : d);
const stagesOf = (xs) => [...new Set((Array.isArray(xs) ? xs : []).map(category).filter(Boolean))];
export const counts = (r) => ({ for: r.evidence.filter((e) => e.for).length, against: r.evidence.filter((e) => !e.for).length });

// A clean rule from an operation. before: the stored rule (or null).
// ai: the coach wrote it, so it can't claim the user's word: a rule the user
// confirmed or stated keeps its wording and status (the AI only adds evidence;
// to change it, it asks), a rejected rule stays rejected, and an inferred
// rule's status follows its evidence. fromAnswer: a new rule taken from the
// user's answer to a question counts as said by the user.
// Otherwise (the user, an answer, a migration) source and status are as given.
// addEvidence: append r.evidence (the AI's runs and answers do); the user's
// edits send the whole rule back, so its evidence is the stored one.
export function cleanRule(r, before = null, { ai = false, addEvidence = ai, now = new Date() } = {}) {
  const at = now.toISOString();
  const added = (Array.isArray(r.evidence) ? r.evidence : [])
    .map((e) => ({ for: e.for !== false, text: str(e.text, 300), at: str(e.at, 40) || at })).filter((e) => e.text);
  const evidence = [...(before?.evidence || []), ...(addEvidence || !before ? added : [])].slice(-MAX_EVIDENCE);
  // Fields left out keep their stored value.
  const text = ai && before && before.source !== 'inferred' ? before
    : Object.fromEntries(['kind', 'when', 'text', 'because', 'stages'].map((k) => [k, r[k] ?? before?.[k]]));
  const rule = {
    id: before?.id || slug(r.id) || slug(r.text) || randomUUID(),
    kind: pick(text.kind, KINDS, 'rule'),
    when: str(text.when, 500), text: str(text.text, 1000), because: str(text.because, 500),
    stages: stagesOf(text.stages),
    status: 'testing', source: 'inferred', evidence,
    createdAt: before?.createdAt || at, updatedAt: at,
  };
  if (!rule.text) return null;
  if (rule.kind === 'fact') rule.when = '';
  if (ai) {
    if (before?.status === 'rejected') return null;
    rule.source = before?.source || (r.fromAnswer ? 'stated' : 'inferred');
    const c = counts(rule);
    rule.status = rule.source !== 'inferred' ? before?.status || 'active' : c.for >= ACTIVE_SUPPORT && !c.against ? 'active' : 'testing';
  } else {
    rule.source = pick(r.source, SOURCES, before?.source || 'stated');
    rule.status = pick(r.status, STATUSES, before?.status || 'active');
  }
  return rule;
}

const lastAt = (r) => r.evidence.at(-1)?.at || r.updatedAt;
// Rules as the drafting AI sees them: facts, then the rules in use (testing ones marked).
export function renderRules(rules = listRules()) {
  const live = rules.filter((r) => r.status !== 'rejected');
  const facts = live.filter((r) => r.kind === 'fact'), dec = live.filter((r) => r.kind === 'rule');
  const mark = (r) => (r.status === 'testing' ? ' (not confirmed yet: follow it unless the situation says otherwise)' : '');
  const line = (r) => `- [${r.id}]${r.stages.length ? ` (${r.stages.join(', ')})` : ''} ${r.when ? `When ${r.when}: ` : ''}${r.text}${r.because ? ` — because ${r.because}` : ''}${mark(r)}`;
  return [
    facts.length && `## Facts about the offer\n${facts.map((r) => `- [${r.id}] ${r.text}${mark(r)}`).join('\n')}`,
    dec.length && `## How the user decides (their rules; they outrank the playbooks when they disagree)\n${dec.map(line).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}
// For the coach: every rule with its status, source and evidence.
export const rulesForCoach = (rules = listRules()) => rules.map((r) => ({
  id: r.id, kind: r.kind, when: r.when, text: r.text, because: r.because, stages: r.stages, status: r.status, source: r.source,
  support: counts(r).for, against: counts(r).against, lastSeen: lastAt(r).slice(0, 10), evidence: r.evidence.slice(-4).map((e) => `${e.for ? '+' : '−'} ${e.text}`),
}));

// ---- questions
export const listQuestions = () => load().questions;
export const openQuestions = () => load().questions.filter((q) => q.status === 'open');
export const getQuestion = (id) => load().questions.find((q) => q.id === id);

// New questions from a learning run, within the limits: at most MAX_OPEN open,
// one batch a day, one open question per rule, none about a rejected rule;
// after three skips in a row only one at a time (the user is busy).
export function addQuestions(qs, now = new Date()) {
  const d = load(), all = d.questions;
  if (!Array.isArray(qs) || !qs.length) return [];
  if (all.some((q) => now - new Date(q.createdAt) < BATCH_GAP)) return [];
  const done = all.filter((q) => q.status !== 'open').slice(-3);
  const room = Math.min(MAX_OPEN - openQuestions().length, done.length === 3 && done.every((q) => q.status === 'skipped') ? 1 : MAX_OPEN);
  const busy = new Set(openQuestions().map((q) => q.ruleId).filter(Boolean));
  const out = [];
  for (const q of qs) {
    if (out.length >= room) break;
    const ruleId = q.ruleId && getRule(q.ruleId) ? q.ruleId : null;
    if (ruleId && (busy.has(ruleId) || getRule(ruleId).status === 'rejected')) continue;
    const options = (Array.isArray(q.options) ? q.options : []).slice(0, 4)
      .map((o, i) => ({ id: `o${i + 1}`, label: str(o.label, 120), text: str(o.text, 3000), effect: ruleId ? pick(o.effect, EFFECTS, 'none') : 'none' }))
      .filter((o) => o.label);
    const prompt = str(q.prompt, 500);
    if (!prompt || options.length < 2) continue;
    const kind = pick(q.kind, QUESTION_KINDS, 'confirm');
    out.push({ id: randomUUID(), kind, prompt, case: str(q.case, 2000), ruleId, options, status: 'open', createdAt: now.toISOString() });
    if (ruleId) busy.add(ruleId);
  }
  d.questions = [...all, ...out].slice(-200);
  save();
  return out;
}

// Answered or skipped; returns the question.
export function closeQuestion(id, patch) {
  const q = getQuestion(id);
  if (!q || q.status !== 'open') return null;
  Object.assign(q, patch, { closedAt: new Date().toISOString() });
  save();
  return q;
}

// Recent questions for the coach, so it doesn't ask the same again.
export const questionsForCoach = (now = new Date()) => load().questions
  .filter((q) => q.status === 'open' || now - new Date(q.closedAt || q.createdAt) < 30 * DAY).slice(-15)
  .map((q) => ({ prompt: q.prompt, ruleId: q.ruleId, status: q.status,
    answer: q.answer ? [q.options.find((o) => o.id === q.answer.optionId)?.label, q.answer.text].filter(Boolean).join(' — ') : null }));
