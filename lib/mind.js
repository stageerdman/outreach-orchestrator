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
// The one line the UI shows per item; the other fields add detail, never repeat it.
const HEADLINE = (eg, what = 'The gist') => ({ type: 'string', description: `${what} in at most 12 words, first person, plain words, readable on its own. E.g. "${eg}"` });
const ITEM = (extra, req) => ({ type: 'object', additionalProperties: false, required: ['id', ...req, 'evidence'], properties: { id: { type: 'string', description: 'Short slug' }, ...extra, evidence: EVIDENCE } });
export const PORTRAIT_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['identity', 'models', 'heuristics', 'conversation', 'values', 'never', 'tensions', 'limits', 'summary'], properties: {
    identity: { type: 'string', description: "2 sentences, at most 40 words, first person, in English: who I am with my clients and what I'm after" },
    models: { type: 'array', items: ITEM({ name: { type: 'string', description: '2–4 words' }, headline: HEADLINE('Silence means I check if it is a real priority.'), line: { type: 'string', description: 'One sentence' },
      apply: { type: 'string', description: 'When this lens applies' }, limits: { type: 'string', description: 'When it fails or I set it aside' } }, ['name', 'headline', 'line', 'apply', 'limits']) },
    heuristics: { type: 'array', items: ITEM({ headline: HEADLINE('He goes quiet after booking → I ask how he is first.', 'Situation → what I do'), when: { type: 'string' }, then: { type: 'string' }, case: { type: 'string', description: 'One real case, anonymised' } }, ['headline', 'when', 'then', 'case']) },
    conversation: { type: 'array', items: ITEM({ lens: { type: 'string', enum: LENS }, headline: HEADLINE('I ask how long it has lasted before I suggest anything.'), text: { type: 'string' }, thin: { type: 'boolean', description: 'True when the evidence is thin' } }, ['lens', 'headline', 'text', 'thin']) },
    values: { type: 'array', items: ITEM({ text: { type: 'string', description: 'At most 15 words' } }, ['text']), description: 'Ranked, most important first' },
    never: { type: 'array', items: ITEM({ headline: HEADLINE('I never remind him of a promise he broke.', 'At most 10 words, starting "I never"'), text: { type: 'string' } }, ['headline', 'text']) },
    tensions: { type: 'array', maxItems: 4, items: ITEM({ between: { type: 'string', description: 'A question of at most 8 words: "X or Y?"' }, text: { type: 'string', description: 'How it plays out, which side wins when' } }, ['between', 'text']) },
    limits: { type: 'array', items: { type: 'string' }, description: "3–4 items, at most 20 words each: what this portrait can't know or gets from thin evidence" },
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
- Every item gets a headline: the gist in at most 12 words that stands on its own; the other fields add detail and never repeat it. At most 4 tensions: the ones that most change what they do.
- limits: three or four concrete ones: thin areas, what the material doesn't cover, that it's based on N conversations up to a date.
- Keep the best evidence per item (2–4 quotes, original language, anonymised: no names, phones, emails). Text in English. Short, concrete sentences in the user's terms, not jargon.`;

// ---- the store
const EMPTY = { portrait: null, research: null, builtAt: null, basis: null, notes: [], scores: [], validation: null, questions: [], askedAt: null, error: '', building: false, step: '' };
let data;
const load = () => (data ??= { ...EMPTY, ...readData('mind', {}), building: false, step: '', asking: false });
const save = () => { const { building, step, asking, ...rest } = load(); writeData('mind', rest); events.emit('personal', {}); };
export const resetMind = () => { data = undefined; };
// Every item id in the portrait (drafts cite them).
export const mindIds = (d = load()) => new Set(d.portrait ? ['models', 'heuristics', 'conversation', 'values', 'never', 'tensions'].flatMap((k) => d.portrait[k].map((x) => x.id)) : []);
export const getMind = () => load();
const setState = (patch) => { Object.assign(load(), patch); events.emit('personal', {}); };

// What the user tells it in their own words: the strongest evidence there is.
export function addNote(text, extra = {}) {
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) return null;
  const d = load();
  d.notes = [...(d.notes || []), { at: new Date().toISOString(), text: t, ...extra }].slice(-100);
  save();
  return d.notes.at(-1);
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
    const prev = d.portrait ? `<previous_portrait>\n${JSON.stringify(d.portrait)}\n</previous_portrait>\nUpdate it with the research below rather than starting over: keep the ids of items that still hold, add new evidence, change what the newer material contradicts.\n\n` : '';
    const told = d.notes?.length ? `<user_says>\nWhat the user told you about how they think, in their own words, oldest first. It outranks every research finding; where they correct the portrait, the portrait changes.\n${d.notes.map((n) => `- (${n.at.slice(0, 10)}) ${n.text}`).join('\n')}\n</user_says>\n\n` : '';
    const portrait = await askClaude({ model, schema: PORTRAIT_SCHEMA, timeout: 15 * 60_000, system: SYNTH_PROMPT,
      prompt: `${prev}${told}<pipeline>Client categories, furthest first: ${STAGES.join(' > ')}</pipeline>\n\n${notes.join('\n\n')}` });
    const basis = Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, { train: p.train.length, used: research[k]?.n ?? 0, test: p.test.length, testFrom: p.test[0]?.at ?? null }]));
    Object.assign(d, { portrait, research, basis, builtAt: new Date().toISOString(), notesUsed: d.notes?.length || 0 });
    save();
  } catch (e) {
    setState({ error: e.message });
    console.error('mind:', e.message);
  } finally { setState({ building: false, step: '' }); }
  return load();
}

// ---- for the drafting prompt
const quotes = (ev) => ev.filter((e) => e.label !== 'inferred').slice(0, 2).map((e) => `"${e.quote}"`).join('; ');
export function renderMind(d = load()) {
  const p = d.portrait;
  if (!p) return '';
  const sec = (title, xs, f) => (xs.length ? `## ${title}\n${xs.map((x) => `- [${x.id}] ${f(x)}`).join('\n')}` : '');
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
    if (!baseline) d.scores = [...(d.scores || []), { at: d.validation.at, n: d.validation.n, with: d.validation.with, without: d.validation.without }].slice(-30);
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

// ---- staying current on its own: build when there's none, rebuild (then test)
// when enough new material came in: REBUILD_AFTER new corrections of drafts,
// any new note from the user, or a week with some new corrections.
export const REBUILD_AFTER = 10;
const WEEK = 7 * DAY;
export function staleness(d = load(), requests = listRequests(), now = new Date()) {
  if (!d.portrait) return 'none';
  const since = (at) => at > d.builtAt;
  const fresh = requests.filter((r) => ['sent', 'done', 'regenerated', 'cancelled'].includes(r.status) && since(r.updatedAt || r.createdAt)
    && (r.note?.trim() || (r.aiText != null && r.aiText.trim() !== (r.text || '').trim()))).length;
  const open = (d.questions || []).some((q) => q.status === 'open');
  if ((d.notes?.length || 0) > (d.notesUsed || 0) && !open) return 'notes';
  if (fresh >= REBUILD_AFTER) return 'decisions';
  if (fresh >= 3 && now - new Date(d.builtAt) > WEEK) return 'week';
  return '';
}
export async function refreshMind(people) {
  if (load().building || !people.some((p) => p.messages?.length)) return load();
  await buildMind(people);
  if (!load().error) await validateMind(people);
  if (!load().error) await maybeAsk(people);
  return load();
}
export const maybeRefresh = (people) => (staleness() ? refreshMind(people) : Promise.resolve(load()));

// ---- questions: after a while (not after every update), the AI asks about
// the thinking behind patterns it can't explain yet; one at a time in the You
// tab, answered or skipped. An answer is the user's own words (a note); when
// the set is done, the portrait rebuilds with them.
export const ASK_AFTER = 15, ASK_GAP = 2 * DAY, MAX_QUESTIONS = 5;
const corrected = (r) => ['sent', 'done', 'regenerated', 'cancelled'].includes(r.status) && (r.note?.trim() || (r.aiText != null && r.aiText.trim() !== (r.text || '').trim()));
// '' when it shouldn't ask now; otherwise why it may.
export function shouldAsk(d = load(), requests = listRequests(), now = new Date()) {
  if (!d.portrait || d.building || d.asking || (d.questions || []).some((q) => q.status === 'open')) return '';
  if (!d.askedAt) return 'first';
  const since = (at) => at > d.askedAt;
  const fresh = requests.filter((r) => corrected(r) && since(r.updatedAt || r.createdAt)).length
    + (d.notes || []).filter((n) => since(n.at) && n.source !== 'answer').length;
  return fresh >= ASK_AFTER && now - new Date(d.askedAt) >= ASK_GAP ? 'gathered' : '';
}

const QUESTIONS_SCHEMA = { type: 'object', additionalProperties: false, required: ['questions'], properties: { questions: { type: 'array', maxItems: MAX_QUESTIONS, items: {
  type: 'object', additionalProperties: false, required: ['ask', 'why', 'case', 'options'],
  properties: {
    ask: { type: 'string', description: 'The question, at most 25 words, plain English, to the user ("you"), neutral, not leading' },
    why: { type: 'string', description: 'At most 20 words: the pattern you noticed that made you ask' },
    case: { type: 'string', description: "One short real example from their material that shows it, so they recall it (original language; the client's first name is fine, never phones or emails), or empty" },
    options: { type: 'array', maxItems: 4, items: { type: 'string' }, description: '2–4 likely answers, at most 8 words each, different from each other; the user can always write their own' },
  } } } } };
const ASK_PROMPT = `You are getting to know how one salesperson thinks (a Czech men's coaching program; the goal is a free diagnostic consultation, then the coaching). You have their portrait (how they think: mental models, rules of thumb, judgment calls, blind spots) and their newest decisions on an AI's drafts (corrections, notes). Look for patterns you can't explain yet: similar cases where they decided differently, a correction whose reason they never said, a judgment call where you don't know what tips it, a blind spot that matters for drafts.

Ask up to ${MAX_QUESTIONS} questions, one thought each, most useful first. Ask about the thinking behind the decisions: what they notice, what tips it, why — never about wording, length or channel. Only ask what would change future drafts if you knew the answer. Never ask what the portrait already states clearly or what <asked_before> already covered. Each question stands alone (it's shown one at a time).`;

export async function askQuestions(people, { model = getSettings().model, requests = listRequests() } = {}) {
  const d = load();
  if (d.asking || !d.portrait) return d;
  setState({ asking: true });
  try {
    const recent = corpus(people, requests).decisions.filter((x) => !d.askedAt || x.at > d.askedAt).slice(-30);
    const before = (d.questions || []).filter((q) => q.status !== 'open').slice(-30)
      .map((q) => `- ${q.ask} → ${q.status === 'answered' ? [q.answer.option, q.answer.text].filter(Boolean).join(' — ') : '(skipped)'}`);
    const { questions } = await askClaude({ model, schema: QUESTIONS_SCHEMA, timeout: 10 * 60_000, system: ASK_PROMPT,
      prompt: `<portrait>\n${renderMind(d)}\n</portrait>\n\n<asked_before>\n${before.join('\n') || '(nothing yet)'}\n</asked_before>\n\n<recent_decisions count="${recent.length}">\n${recent.map((x) => x.text).join('\n\n') || '(none since the last questions)'}\n</recent_decisions>` });
    const at = new Date().toISOString();
    const fresh = questions.filter((q) => q.ask?.trim()).slice(0, MAX_QUESTIONS).map((q, i) => ({
      id: `q${Date.now().toString(36)}${i}`, at, ask: q.ask.trim(), why: (q.why || '').trim(), case: anonymize((q.case || '').trim()),
      options: (q.options || []).map((o) => String(o).trim()).filter(Boolean).slice(0, 4), status: 'open' }));
    Object.assign(d, { questions: [...(d.questions || []), ...fresh].slice(-100), askedAt: at });
    save();
  } catch (e) {
    console.error('mind questions:', e.message);
  } finally { setState({ asking: false }); }
  return load();
}
export const maybeAsk = (people) => (shouldAsk() ? askQuestions(people) : Promise.resolve(load()));
export const openQuestions = (d = load()) => (d.questions || []).filter((q) => q.status === 'open');

// Answered (a suggested answer and/or own words) or skipped. Returns
// { question, done } — done: the set is finished and answers came in, so the
// caller rebuilds the portrait.
export function closeQuestion(id, { option = '', text = '', skip = false } = {}) {
  const d = load(), q = (d.questions || []).find((x) => x.id === id && x.status === 'open');
  if (!q) return null;
  option = q.options.includes(option) ? option : ''; text = String(text || '').trim().slice(0, 2000);
  if (!skip && !option && !text) return null;
  Object.assign(q, skip ? { status: 'skipped', closedAt: new Date().toISOString() }
    : { status: 'answered', answer: { option, text, at: new Date().toISOString() } });
  if (!skip) addNote(`Asked "${q.ask}", I answered: ${[option, text].filter(Boolean).join(' — ')}`, { source: 'answer', qid: q.id });
  else save();
  const done = !openQuestions(d).length && d.questions.some((x) => x.at === q.at && x.status === 'answered');
  return { question: q, done };
}
