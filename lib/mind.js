// The portrait of how the user thinks (PERSONALIZATION update v2), after the
// agent-creator / nuwa-skill method: first-hand material → research runs, one
// per dimension, each finding tied to quotes and labelled said / observed /
// inferred → one synthesis that keeps only what recurs, predicts and is the
// user's own (not generic sales advice) → mind.json in the app data folder.
// The newest HOLDOUT of every dimension is never shown to these runs; the
// validation (later) tests the portrait on it.
import { askClaude } from './claude.js';
import { readData, writeData } from './cache.js';
import { events } from './events.js';
import { getSettings } from './settings.js';
import { anonymize } from './style.js';
import { listRequests } from './requests.js';
import { listRules, listQuestions } from './rules.js';
import { STAGES } from './resultson.js';

const LABEL = { email: 'Email', whatsapp: 'WhatsApp' };
const DAY = 864e5, TOUCH = 6 * 36e5, HOLDOUT = 0.15;
const clip = (s, n) => (s.length > n ? s.slice(0, n) + ' …' : s);
const isMedia = (m) => /^\[[\w ]+\]$/.test((m.text || '').trim());
const line = (m) => `[${m.at.slice(0, 10)} · ${LABEL[m.channel] || m.channel} · ${m.fromMe ? 'ME' : 'CLIENT'}] ${anonymize(clip((m.text || '').trim(), m.fromMe ? 900 : 400))}`;

// The client pushes back (not logistics like moving a call by half an hour):
// no time or money, too expensive, will think, not now, will get back, not for
// me, won't come, cancels, his wife decides, doesn't believe it helps.
export const RESISTS = /nem(á|a)m (teď )?(čas|peníze|na to)|nem(á|a)m teď|(je|to je|moc|příliš) drah|nemůžu si to dovolit|rozmysl|promysl|zvážím|zatím ne|teď ne\b|ozvu se|nechci|nezájem|nemám zájem|není (to )?pro mě|uvidím|nepřijd|nedorazím|nedorazil|zruš(it|ím|il)|(s )?manželk|nevěřím|nepomůže|nemá (to )?smysl|nebudu|vzdávám/i;

// ---- the corpus: one list of items per dimension, oldest first. Each item
// { at, text } (text: what the research run reads), from the snapshot's
// conversations and the user's decisions on drafts; testable ones also carry
// { situation, actual }: what the user faced, what they did (the validation).
export function corpus(people, requests = listRequests(), { rules = listRules(), questions = listQuestions() } = {}) {
  const replies = [], hard = [], quiet = [];
  for (const p of people) {
    const msgs = (p.messages || []).filter((m) => m.text?.trim() && !isMedia(m));
    const stage = p.stage?.label || 'unknown';
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      // The first of my run of messages (a new touch after 6 hours counts again).
      if (!m.fromMe || (i && msgs[i - 1].fromMe && new Date(m.at) - new Date(msgs[i - 1].at) < TOUCH)) continue;
      const prev = msgs[i - 1];
      let j = i + 1;
      while (j < msgs.length && msgs[j].fromMe && new Date(msgs[j].at) - new Date(msgs[j - 1].at) < TOUCH) j++;
      const before = msgs.slice(Math.max(0, i - 3), i).map(line).join('\n') || '(no earlier messages)';
      const test = (head) => ({ situation: `${head}\n${before}`, actual: msgs.slice(i, j).map(line).join('\n') });
      const silent = !prev || new Date(m.at) - new Date(prev.at) > DAY;
      if (prev && !silent && RESISTS.test(prev.text)) {
        // A hard moment: before, my answer, and how the client took it (and what I did then).
        hard.push({ ...test(`Category: ${stage}. The client just wrote:`), at: m.at, text: `<moment stage="${stage}">\n${msgs.slice(Math.max(0, i - 3), i + 4).map(line).join('\n')}\n</moment>` });
      } else if (prev && !silent) {
        replies.push({ ...test(`Category: ${stage}. The conversation so far:`), at: m.at, text: `<exchange stage="${stage}">\n${msgs.slice(Math.max(0, i - 3), i + 3).map(line).join('\n')}\n</exchange>` });
      } else {
        const days = prev ? Math.round((new Date(m.at) - new Date(prev.at)) / DAY) : null;
        quiet.push({ ...test(`Category: ${stage}. ${days == null ? 'First contact.' : `The client has been silent for ${days} days.`} Before:`), at: m.at, text: `<followup stage="${stage}" silence="${days == null ? 'first contact' : `${days} days`}">\n${msgs.slice(Math.max(0, i - 2), i + 3).map(line).join('\n')}\n</followup>` });
      }
    }
  }
  // My corrections of the AI: notes and edits on its drafts, my answers to its questions, rules I confirmed or wrote.
  const DID = { sent: 'sent it', done: 'sent it', regenerated: 'asked for another version', cancelled: 'cancelled it' };
  const edited = (r) => r.aiText != null && r.aiText.trim() !== (r.text || '').trim();
  const decisions = requests.filter((r) => DID[r.status] && r.context && (r.note?.trim() || edited(r))).map((r) => ({
    at: r.updatedAt || r.createdAt,
    situation: `Category: ${r.context.stage || 'unknown'}. The conversation:\n${(r.context.messages || []).slice(-4).map(line).join('\n') || '(none)'}\nAn AI drafted for the user: ${anonymize(clip(r.aiText ?? r.text, 900))}\nWhat does the user do with this draft, and why?`,
    actual: `${edited(r) ? `The user did not use the draft as written: they rewrote it and ${r.status === 'sent' || r.status === 'done' ? 'sent their own version' : DID[r.status]}.` : `The user ${DID[r.status]}.`}`
      + `${r.note?.trim() ? ` Their note: "${r.note.trim()}"` : ''}${edited(r) ? `\nTheir version: ${anonymize(clip(r.text, 900))}` : ''}`,
    text: `<correction stage="${r.context.stage || ''}">\n${(r.context.messages || []).slice(-4).map(line).join('\n')}\n`
      + `AI's draft: ${anonymize(clip(r.aiText ?? r.text, 900))}\nI ${DID[r.status]}.${r.note?.trim() ? ` My note: "${r.note.trim()}"` : ''}`
      + `${edited(r) ? `\nMy version: ${anonymize(clip(r.text, 900))}` : ''}\n</correction>` }));
  for (const q of questions.filter((x) => x.status === 'answered' && x.answer)) {
    const o = q.options.find((x) => x.id === q.answer.optionId);
    decisions.push({ at: q.answer.at, text: `<answer>\nThe AI asked me: ${q.prompt}${q.case ? `\nThe case: ${q.case}` : ''}\nI answered: ${[o?.label, q.answer.text].filter(Boolean).join(' — ')}\n</answer>` });
  }
  for (const r of rules.filter((x) => x.kind === 'rule' && x.status !== 'rejected' && x.source !== 'inferred')) {
    decisions.push({ at: r.updatedAt, text: `<said>\nI ${r.source === 'stated' ? 'wrote' : 'confirmed'}: ${r.when ? `when ${r.when}: ` : ''}${r.text}${r.because ? ` — because ${r.because}` : ''}\n</said>` });
  }
  const byAt = (a, b) => a.at.localeCompare(b.at);
  return { replies: replies.sort(byAt), hard: hard.sort(byAt), quiet: quiet.sort(byAt), decisions: decisions.sort(byAt) };
}

// The newest share of each dimension is kept back for the validation.
export function split(items, share = HOLDOUT) {
  const n = items.length >= 7 ? Math.max(1, Math.round(items.length * share)) : 0;
  return { train: items.slice(0, items.length - n), test: items.slice(items.length - n) };
}

// What one research run reads: the newest items first until the budget is used,
// then back in time order.
export function pack(items, budget) {
  const out = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0 && used + items[i].text.length <= budget; i--) { out.push(items[i]); used += items[i].text.length; }
  return out.reverse();
}

// ---- research: one run per dimension (agent-creator's Phase 1, over the user's own material)
export const DIMENSIONS = {
  hard: { title: 'Hard moments', budget: 90_000, focus: `Moments where the client pushes back: can't come, no time, no money, will think about it, postpones, cancels, doubts, declines. For each, what did I do — accept, challenge, ask, reframe, hold a line, let go — and what does that say about how I read the person and what I believe? This is where my thinking shows most.` },
  decisions: { title: 'My corrections of the AI', budget: 90_000, focus: `Where I corrected an AI's draft: my notes, my edits, my answers, what I said outright. Each one is a place where my judgement differs from a reasonable default. What did the AI assume that I don't? What do I see in the client that it missed? Wording-only edits matter only when the change reveals a judgement (e.g. I removed a push, a promise, a question).` },
  replies: { title: 'How I lead conversations', budget: 110_000, focus: `Ordinary back-and-forth with clients. How I lead: what I ask and when, how much I explain vs. ask, how I move someone toward a decision or the next step, how I respond to good news, to questions, to hesitation, how I balance warmth and directness, how I close an exchange.` },
  quiet: { title: 'Clients who went quiet', budget: 60_000, focus: `My messages after a client went silent (and first contacts). How do I see silence, when do I keep going and when do I stop, what do I bring when I come back, what do I never do to a quiet client?` },
};
const LENS = ['probing', 'challenge-support', 'specifics', 'resistance', 'reframing', 'arc', 'closing', 'signals'];
const EVIDENCE = { type: 'array', items: { type: 'object', additionalProperties: false, required: ['quote', 'label'],
  properties: { quote: { type: 'string', description: 'Verbatim from the material (original language), or a one-line description of what I did' },
    label: { type: 'string', enum: ['said', 'observed', 'inferred'], description: 'said: I stated it myself (a note, an answer, a message saying what I think); observed: what I did; inferred: your reading' } } } };
const RESEARCH_SCHEMA = { type: 'object', additionalProperties: false, required: ['findings', 'contradictions', 'thin'], properties: {
  findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claim', 'situations', 'evidence', 'count'],
    properties: { claim: { type: 'string', description: 'How I think: a belief, a way of reading clients, a stance, a line I hold — in English' },
      situations: { type: 'array', items: { type: 'string' }, description: 'The different kinds of situation it showed up in' },
      evidence: EVIDENCE, count: { type: 'number', description: 'How many items in the material show it' } } } },
  contradictions: { type: 'array', items: { type: 'string' }, description: 'Where I acted differently in similar cases; kept, not explained away' },
  thin: { type: 'array', items: { type: 'string' }, description: "What this material can't tell" },
} };
const RESEARCH_PROMPT = `You study how one person thinks, from their own first-hand material: the user is a salesperson for a Czech men's coaching program (leads come from ads; the goal is a free diagnostic consultation, then the coaching, paid in full or in installments). You read real situations with their clients and what they did. Capture HOW THEY THINK, not what they wrote: how they read a client, what they believe, what they weigh, what they push for, refuse or let go, how they lead the person. Not their wording, greetings, length or channel (a separate guide covers voice).

Rules:
- Every finding needs evidence: verbatim quotes (original language) or a concrete description of what they did, labelled said / observed / inferred. Separate what they said about their thinking from what they did from your reading.
- A belief that shows up again and again, across different situations, matters most; note how many items show it.
- Keep contradictions: when they acted differently in similar cases, record it; don't invent a reconciling story.
- Generic sales advice ("build rapport", "follow up") is worthless unless their material shows their own twist on it.
- Never client names, phone numbers or emails in claims; quotes may keep the client's words only when needed and anonymised.
- "thin": say honestly what this material can't show.`;

// ---- synthesis: the portrait (Phase 2: triple verification; Phase 3: the template)
const ITEM = (extra, req) => ({ type: 'object', additionalProperties: false, required: ['id', ...req, 'evidence'], properties: { id: { type: 'string', description: 'Short slug' }, ...extra, evidence: EVIDENCE } });
export const PORTRAIT_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['identity', 'models', 'heuristics', 'conversation', 'values', 'never', 'tensions', 'limits', 'summary'], properties: {
    identity: { type: 'string', description: "2–3 sentences, first person, in English: who I am with my clients and what I'm after" },
    models: { type: 'array', items: ITEM({ name: { type: 'string' }, line: { type: 'string', description: 'One sentence' },
      apply: { type: 'string', description: 'When this lens applies' }, limits: { type: 'string', description: 'When it fails or I set it aside' } }, ['name', 'line', 'apply', 'limits']) },
    heuristics: { type: 'array', items: ITEM({ when: { type: 'string' }, then: { type: 'string' }, case: { type: 'string', description: 'One real case, anonymised' } }, ['when', 'then', 'case']) },
    conversation: { type: 'array', items: ITEM({ lens: { type: 'string', enum: LENS }, text: { type: 'string' }, thin: { type: 'boolean', description: 'True when the evidence is thin' } }, ['lens', 'text', 'thin']) },
    values: { type: 'array', items: ITEM({ text: { type: 'string' } }, ['text']), description: 'Ranked, most important first' },
    never: { type: 'array', items: ITEM({ text: { type: 'string' } }, ['text']) },
    tensions: { type: 'array', items: ITEM({ between: { type: 'string', description: 'X vs. Y' }, text: { type: 'string', description: 'How it plays out, which side wins when' } }, ['between', 'text']) },
    limits: { type: 'array', items: { type: 'string' }, description: "What this portrait can't know or gets from thin evidence" },
    summary: { type: 'string', description: 'Two sentences for the user: what stands out, what is least sure' },
  } };
const SYNTH_PROMPT = `You build a portrait of how one person thinks, from research notes on their own material (each note: findings with quotes labelled said / observed / inferred, contradictions, gaps). The user is a salesperson for a Czech men's coaching program. An AI will use this portrait to decide, for each client, what this person would do and why, before writing in their voice (voice is covered elsewhere). It must capture their thinking, not their wording.

Test every candidate with three checks:
1. Recurs: shows up in at least two different kinds of situation (or dimensions).
2. Generative: it lets you predict what they'd do in a new case.
3. Their own: not every good salesperson thinks so; generic sales advice fails.
Three passes → a mental model (3–7, the lenses they see clients through: name, one line, evidence from ≥2 situations, when it applies, its limits). One or two → a heuristic (5–10: when → then, with one real case). None → drop it. Fewer and deep beats many and shallow.

Not thinking, leave out: team templates and sequence steps (a standard opener, a closing notice, booking links, prep videos, payment links, handovers) — those live in the playbooks. A heuristic must be a judgement the user makes about this person and this moment, not a step they always take. Notice the person behind the tactics: how they treat the man himself (curiosity about his life, how they react to his pain or good news) is often the most predictive part.

Also:
- conversation: how they lead a conversation, one entry per lens where there's evidence (probing: what and how much they ask before steering; challenge-support: where they sit between pushing and supporting and what makes them push harder; specifics: how they pin vague answers down; resistance: what they do when the client evades, objects or says no; reframing: how they turn the question around; arc: how an exchange typically unfolds; closing: what they insist on before an exchange ends; signals: what they read in the client). Mark thin ones; skip lenses with no evidence. Never fill one with generic coaching talk.
- values: 3–5, ranked. never: things they clearly refuse to do. tensions: at least two real ones if the material shows them (e.g. two values pulling apart), with which side wins when; never resolve them away.
- What they said outranks what you inferred; what they did outranks what they said when the two disagree (note the gap as a tension or limit). A newer pattern beats an older one when they changed their mind.
- limits: at least three concrete ones: thin areas, what the material doesn't cover, that it's based on N conversations up to a date.
- Keep the best evidence per item (2–4 quotes, original language, anonymised: no names, phones, emails). Text in English. Short, concrete sentences in the user's terms, not jargon.`;

// ---- the store
const EMPTY = { portrait: null, research: null, builtAt: null, basis: null, marks: {}, error: '', building: false, step: '' };
let data;
const load = () => (data ??= { ...EMPTY, ...readData('mind', {}), building: false, step: '' });
const save = () => { const { building, step, ...rest } = load(); writeData('mind', rest); events.emit('personal', {}); };
export const resetMind = () => { data = undefined; };
export const getMind = () => load();
const setState = (patch) => { Object.assign(load(), patch); events.emit('personal', {}); };

// The user's verdict on one item: 'me' | 'not' | null.
export function markItem(id, mark) {
  const d = load();
  if (mark) d.marks[id] = { mark, at: new Date().toISOString() }; else delete d.marks[id];
  save();
  return d.marks;
}

// Builds the portrait: research per dimension (two at a time), then the synthesis.
export async function buildMind(people, { model = getSettings().model } = {}) {
  const d = load();
  if (d.building) return d;
  const all = corpus(people);
  const parts = Object.fromEntries(Object.entries(all).map(([k, items]) => [k, split(items)]));
  setState({ building: true, step: 'Reading your conversations', error: '' });
  try {
    const research = {};
    await Promise.all(Object.entries(DIMENSIONS).map(async ([k, dim]) => {
      const items = pack(parts[k].train, dim.budget);
      if (!items.length) { research[k] = { findings: [], contradictions: [], thin: ['No material yet'], n: 0 }; return; }
      const out = await askClaude({ model, schema: RESEARCH_SCHEMA, timeout: 15 * 60_000, system: RESEARCH_PROMPT,
        prompt: `<dimension name="${dim.title}">\n${dim.focus}\n</dimension>\n\n<material count="${items.length}" from="${items[0].at.slice(0, 10)}" to="${items.at(-1).at.slice(0, 10)}">\n${items.map((x) => x.text).join('\n\n')}\n</material>` });
      research[k] = { ...out, n: items.length, from: items[0].at, to: items.at(-1).at };
    }));
    setState({ step: 'Putting the portrait together' });
    const notes = Object.entries(DIMENSIONS).map(([k, dim]) => `<research dimension="${dim.title}" items="${research[k].n}">\n${JSON.stringify({ findings: research[k].findings, contradictions: research[k].contradictions, thin: research[k].thin }, null, 1)}\n</research>`);
    const prev = d.portrait ? `<previous_portrait>\n${JSON.stringify(d.portrait)}\n</previous_portrait>\n<user_marks>\n${JSON.stringify(marksFor(d))}\n</user_marks>\nKeep the ids of items that still hold. Items the user marked "not me" are wrong: drop or correct them. "that's me" items stay unless the material clearly contradicts them.\n\n` : '';
    const portrait = await askClaude({ model, schema: PORTRAIT_SCHEMA, timeout: 15 * 60_000, system: SYNTH_PROMPT,
      prompt: `${prev}<pipeline>Client categories, furthest first: ${STAGES.join(' > ')}</pipeline>\n\n${notes.join('\n\n')}` });
    const basis = Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, { train: p.train.length, used: research[k]?.n ?? 0, test: p.test.length, testFrom: p.test[0]?.at ?? null }]));
    Object.assign(d, { portrait, research, basis, builtAt: new Date().toISOString() });
    save();
  } catch (e) {
    setState({ error: e.message });
    console.error('mind:', e.message);
  } finally { setState({ building: false, step: '' }); }
  return load();
}

const marksFor = (d) => Object.entries(d.marks).map(([id, m]) => ({ id, mark: m.mark === 'me' ? "that's me" : 'not me' }));

// ---- for the drafting prompt: the portrait without the items the user rejected
const quotes = (ev) => ev.filter((e) => e.label !== 'inferred').slice(0, 2).map((e) => `"${e.quote}"`).join('; ');
export function renderMind(d = load()) {
  const p = d.portrait;
  if (!p) return '';
  const ok = (x) => d.marks[x.id]?.mark !== 'not';
  const sure = (x) => (d.marks[x.id]?.mark === 'me' ? ' (confirmed by the user)' : '');
  const sec = (title, xs, f) => (xs.filter(ok).length ? `## ${title}\n${xs.filter(ok).map((x) => `- [${x.id}] ${f(x)}${sure(x)}`).join('\n')}` : '');
  return [
    p.identity,
    sec('Mental models (the lenses they see clients through)', p.models, (m) => `**${m.name}**: ${m.line} Applies: ${m.apply} Limits: ${m.limits}${quotes(m.evidence) ? ` E.g. ${quotes(m.evidence)}` : ''}`),
    sec('Heuristics', p.heuristics, (h) => `When ${h.when}: ${h.then} (case: ${h.case})`),
    sec('How they lead a conversation', p.conversation, (c) => `${c.lens}: ${c.text}${c.thin ? ' (thin evidence)' : ''}`),
    sec('Values, most important first', p.values, (v) => v.text),
    sec('Never', p.never, (v) => v.text),
    sec('Tensions (both sides are real; follow which wins when)', p.tensions, (t) => `${t.between}: ${t.text}`),
    p.limits.length ? `## Limits of this portrait\n${p.limits.map((l) => `- ${l}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

// ---- validation (agent-creator's Phase 4 / fidelity scorecard): on held-out
// real moments, one run predicts what the user did and why with the portrait,
// one without (a capable generic salesperson); a third, blind (X/Y shuffled),
// grades each prediction against what the user really did. Never self-graded.
const TEST_CAP = { hard: 10, decisions: 10, quiet: 15, replies: 15 };
const VERDICT = { same: 1, partly: 0.5, different: 0 };
export function testCases(people, opts) {
  const all = corpus(people, opts?.requests, opts);
  return Object.entries(TEST_CAP).flatMap(([k, n]) => split(all[k]).test.filter((x) => x.situation).slice(-n).map((x) => ({ dim: k, ...x })));
}
const PREDICT_SCHEMA = { type: 'object', additionalProperties: false, required: ['predictions'], properties: { predictions: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['n', 'does', 'why', 'ids'],
  properties: { n: { type: 'number' }, does: { type: 'string', description: 'What they do next (or that they wait, let go, cancel the draft), with the gist of what they say' },
    why: { type: 'string', description: 'The reasoning in their head' }, ids: { type: 'array', items: { type: 'string' }, description: 'Portrait item ids relied on (empty without a portrait)' } } } } } };
const GRADE_SCHEMA = { type: 'object', additionalProperties: false, required: ['grades'], properties: { grades: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['n', 'x', 'y'],
  properties: { n: { type: 'number' }, x: { type: 'string', enum: Object.keys(VERDICT) }, y: { type: 'string', enum: Object.keys(VERDICT) } } } } } };
const PREDICT_PROMPT = `You predict what one salesperson (a Czech men's coaching program: free diagnostic consultation, then the coaching) does next in real situations with their clients. For each <case>: what they do next and the gist of what they say, and the reasoning in their head. Predict their judgement (push or wait, challenge or accept, what they focus on, what they refuse), not their wording.`;
const GRADE_PROMPT = `For each <case> you get what a salesperson really did next (<real>) and two predictions, X and Y, made without seeing it. Grade each on judgement only: did it get what they did and the stance behind it (pushed or waited, challenged or accepted, what they focused on, what they held back)? Wording and language don't matter. "same": the same judgement; "partly": the right move but a different reason or emphasis, or half of it; "different": a different judgement.`;

// baseline: what the other side knows ('' = nothing; e.g. the v1 rules, to compare).
export async function validateMind(people, { model = getSettings().model, opts, baseline = '' } = {}) {
  const d = load();
  if (!d.portrait || d.building) return d;
  const cases = testCases(people, opts);
  if (!cases.length) { setState({ error: 'Not enough held-out moments to test yet' }); return d; }
  setState({ building: true, step: 'Testing the portrait on moments it has never seen', error: '' });
  try {
    const list = (f) => cases.map((c, i) => `<case n="${i + 1}">\n${f(c)}\n</case>`).join('\n\n');
    const predict = (portrait) => askClaude({ model, schema: PREDICT_SCHEMA, timeout: 10 * 60_000,
      system: `${PREDICT_PROMPT}\n\n${portrait ? `# How this person thinks\n${portrait}\n\nCite the ids you rely on in "ids".` : baseline ? `# What is known about this person\n${baseline}\n\n"ids": empty.` : 'You know nothing about this person: predict what a capable salesperson in this business would do. "ids": empty.'}`,
      prompt: list((c) => c.situation) });
    const [withP, withoutP] = await Promise.all([predict(renderMind(d)), predict('')]); // '' → baseline
    const W = new Map(withP.predictions.map((p) => [p.n, p])), WO = new Map(withoutP.predictions.map((p) => [p.n, p]));
    const flip = cases.map(() => Math.random() < 0.5);
    const txt = (p) => (p ? `${p.does} — because ${p.why}` : '(no prediction)');
    const { grades } = await askClaude({ model, schema: GRADE_SCHEMA, timeout: 10 * 60_000, system: GRADE_PROMPT,
      prompt: list((c) => { const i = cases.indexOf(c), [x, y] = flip[i] ? [WO, W] : [W, WO];
        return `${c.situation}\n<real>\n${c.actual}\n</real>\n<x>${txt(x.get(i + 1))}</x>\n<y>${txt(y.get(i + 1))}</y>`; }) });
    d.validation = { at: new Date().toISOString(), portraitAt: d.builtAt, baseline: baseline ? 'given' : 'none', ...scoreValidation(cases, W, grades, flip, WO) };
    save();
  } catch (e) {
    setState({ error: e.message });
    console.error('mind:', e.message);
  } finally { setState({ building: false, step: '' }); }
  return load();
}

// Points of 100 with vs. without the portrait, per dimension, and how often
// each portrait item was relied on and how right that was.
export function scoreValidation(cases, withMap, grades, flip, withoutMap = new Map()) {
  const G = new Map(grades.map((g) => [g.n, g]));
  const tot = () => ({ n: 0, with: 0, without: 0 });
  const all = tot(), dims = {}, items = {}, rows = [];
  cases.forEach((c, i) => {
    const g = G.get(i + 1);
    if (!g) return;
    const [w, wo] = flip[i] ? [g.y, g.x] : [g.x, g.y];
    for (const t of [all, (dims[c.dim] ??= tot())]) { t.n++; t.with += VERDICT[w]; t.without += VERDICT[wo]; }
    for (const id of new Set(withMap.get(i + 1)?.ids || [])) { const x = (items[id] ??= { used: 0, right: 0 }); x.used++; x.right += VERDICT[w]; }
    const said = (p) => (p ? `${p.does} — because ${p.why}` : '');
    rows.push({ dim: c.dim, at: c.at, with: w, without: wo, situation: c.situation, actual: c.actual, predicted: said(withMap.get(i + 1)), generic: said(withoutMap.get(i + 1)) });
  });
  const pts = (t) => ({ n: t.n, with: t.n ? Math.round((100 * t.with) / t.n) : 0, without: t.n ? Math.round((100 * t.without) / t.n) : 0 });
  return { ...pts(all), dims: Object.fromEntries(Object.entries(dims).map(([k, t]) => [k, pts(t)])), items, rows };
}
