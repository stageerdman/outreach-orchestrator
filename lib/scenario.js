// The scenario a chat is in, worked out by code from the playbooks: which
// playbook, and without a reply the exact step (touches since the client last
// wrote → step N+1, its wait passed or not); with a reply, the response
// branches the AI picks from. Drafts (and the copilot) open with it. Pure.
import { listPlaybooks, templateText } from './playbooks.js';
import { category } from './resultson.js';

// Where the client is in a follow-up sequence: my touches since the client's
// last message (messages of mine less than 6 hours apart are one touch).
const DAY = 864e5, TOUCH_GAP = 6 * 36e5;
export function followupState(messages = [], now = new Date()) {
  const lastClient = messages.findLastIndex((m) => !m.fromMe);
  const mine = messages.slice(lastClient + 1).filter((m) => m.fromMe);
  const touches = mine.filter((m, i) => i === 0 || new Date(m.at) - new Date(mine[i - 1].at) > TOUCH_GAP);
  const days = (at) => (at ? Math.floor((now - new Date(at)) / DAY) : null);
  return {
    followups: touches.length, clientEverWrote: lastClient >= 0,
    daysSinceClient: lastClient >= 0 ? days(messages[lastClient].at) : null,
    daysSinceMine: days(mine.at(-1)?.at), channels: touches.map((m) => m.channel),
  };
}

const LABEL = { email: 'Email', whatsapp: 'WhatsApp', any: 'any channel' };
const SITUATION = { 'first-contact': 'first contact', 'no-reply': 'no reply', conversation: 'the client wrote last' };
const uniq = (xs) => [...new Set(xs)];

// The client wrote last → conversation; never wrote → first contact; else no reply.
export function situationOf(f) {
  if (f.clientEverWrote && !f.followups) return 'conversation';
  return f.clientEverWrote ? 'no-reply' : 'first-contact';
}

// The stage's playbooks (the matching situation first, then those with steps
// or branches), else the universal ones (no stages).
function pick(playbooks, stage, want, has) {
  const ofStage = playbooks.filter((p) => stage && p.stages.includes(stage));
  const universal = playbooks.filter((p) => !p.stages.length);
  return [...ofStage.filter((p) => p.situation === want && has(p)), ...ofStage.filter((p) => p.situation !== want && has(p)),
    ...universal.filter((p) => p.situation === want && has(p)), ...universal.filter((p) => p.situation !== want && has(p))];
}

export function scenarioOf(person, playbooks = listPlaybooks(), now = new Date()) {
  const stage = category(person.stage?.label) || person.stage?.label || '';
  const f = followupState(person.messages || [], now), situation = situationOf(f);
  const head = (pb) => ({ playbookId: pb.id, playbookName: pb.name, situation });
  const where = `${stage || 'Unknown stage'} · ${SITUATION[situation]}`;
  if (situation === 'conversation') {
    const pbs = pick(playbooks, stage, 'conversation', (p) => p.responses.length);
    if (!pbs.length) return null;
    // The stage's own branches, then the universal ones; one per id.
    const own = pbs.filter((p) => p.stages.length), uni = pbs.filter((p) => !p.stages.length);
    const seen = new Set(), candidates = [];
    for (const p of [...(own.length ? [own[0]] : []), ...uni])
      for (const r of p.responses) if (!seen.has(r.id)) { seen.add(r.id); candidates.push({ id: r.id, playbookId: p.id, when: r.when, approach: r.approach, templateIds: r.templateIds }); }
    return { ...head(pbs[0]), step: null, candidates, templateIds: uniq(candidates.flatMap((c) => c.templateIds)),
      text: `${where} · pick the reply branch that fits (${candidates.length}): ${candidates.map((c) => c.when).join(' / ')}` };
  }
  const [pb] = pick(playbooks, stage, 'no-reply', (p) => p.steps.length);
  if (!pb) return null;
  const s = pb.steps[f.followups];
  if (!s) return { ...head(pb), step: null, candidates: [], templateIds: [],
    text: `${where} · the sequence is finished (all ${pb.steps.length} steps sent)` };
  const dueInDays = f.daysSinceMine == null ? 0 : s.waitDays - f.daysSinceMine;
  const step = { id: s.id, n: f.followups + 1, of: pb.steps.length, channel: s.channel, ask: s.ask, why: s.why, waitDays: s.waitDays, dueInDays };
  const due = dueInDays <= 0 ? 'due now' : `due in ${dueInDays} day(s)`;
  return { ...head(pb), step, candidates: [], templateIds: s.templateIds,
    text: `${where} · step ${step.n} of ${step.of} (${LABEL[s.channel] || s.channel}, ${due}): ${s.ask}` };
}

export const SCENARIO_HOW = `This is where the client is in our playbooks, worked out from the conversation. Follow it: it says what to send. When templates are listed, use one: keep its wording, fill its placeholders ({{ NAME }}, {{gender:male|female}}) from what you know, adapt only what this situation needs, and set "templateId" and "stepId". Write your own message only when none of them fits, and then say why in "reasoning". The user's instruction for this draft outranks the scenario; the portrait of how the user thinks may justify a deviation (e.g. waiting, or asking instead of offering): then say so in "reasoning".`;

// The prompt block: the scenario, its templates by id and name, and how to use them.
export function renderScenario(s, templates = []) {
  if (!s) return '';
  const byId = new Map(templates.map((t) => [t.id, t]));
  const tpl = (ids) => ids.map((id) => byId.get(id)).filter(Boolean).map(templateText)
    .map((t) => `### ${t.id} · ${t.name || 'Untitled'}\n${t.subject ? `Subject: ${t.subject}\n` : ''}${t.body}`).join('\n\n');
  const out = [`# Scenario\n${SCENARIO_HOW}\n\n${s.text}\nPlaybook: ${s.playbookId} · ${s.playbookName}`];
  if (s.step) {
    const st = s.step;
    out.push(`## Step [${st.id}], ${st.n} of ${st.of}\nChannel: ${LABEL[st.channel] || st.channel} · wait ${st.waitDays} day(s) after our last message · `
      + (st.dueInDays <= 0 ? 'due now' : `not due for ${st.dueInDays} more day(s) (the user asked for a draft anyway; write this step unless waiting is clearly better, and say so)`)
      + `\nAsk: ${st.ask}${st.why ? `\nWhy: ${st.why}` : ''}`);
    const t = tpl(s.templateIds);
    out.push(t ? `## Templates for this step\n${t}` : '## Templates for this step\n(none: write it yourself, following the ask)');
  } else if (s.candidates.length) {
    out.push(`## Reply branches (pick the one that matches what the client said; set "playbookId" and "stepId" to its ids)\n`
      + s.candidates.map((c) => `- [${c.id}] (playbook ${c.playbookId}) when ${c.when}: ${c.approach}${c.templateIds.length ? ` [templates: ${c.templateIds.join(', ')}]` : ''}`).join('\n'));
    const t = tpl(s.templateIds);
    if (t) out.push(`## Templates for these branches\n${t}`);
  } else out.push('The sequence is finished: every step was sent without a reply. Send nothing more unless the conversation clearly calls for it; say why in "reasoning".');
  return out.join('\n\n');
}

// What a draft keeps of its scenario.
export const scenarioSummary = (s) => (s ? { playbookId: s.playbookId, stepId: s.step?.id ?? null, situation: s.situation, text: s.text } : null);
