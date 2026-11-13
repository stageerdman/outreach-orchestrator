import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { crmSource } from './lib/crm.js';
import { emailConfigured, smtpConfigured } from './lib/email.js';
import { whatsappConfigured, whatsappKnown } from './lib/whatsapp.js';
import { listTemplates, saveTemplate, deleteTemplate } from './lib/templates.js';
import { refresh, syncState, snapshotPeople, restoreSnapshot, startLive } from './lib/sync.js';
import { chatList, markRead, markUnread } from './lib/chats.js';
import { events } from './lib/events.js';
import { getSettings, saveSettings, DRAFT_PROMPT, STYLE_PROMPT, COACH_PROMPT, BUILD_PROMPT, MODELS } from './lib/settings.js';
import { listPlaybooks, listChanges, applyOperations, undoChange } from './lib/playbooks.js';
import { buildPlaybooks, coachState, learnNow, distill, pastDecisions, replay, replayCases, listReplays, fidelity, answerQuestion, skipQuestion, migrateLessons } from './lib/coach.js';
import { listRules, openQuestions, getRule } from './lib/rules.js';
import * as ai from './lib/assistant.js';

const PORT = Number(process.env.PORT || 3000);
restoreSnapshot();
migrateLessons(); // once: the playbooks' lessons become rules

// The Tasks feed: people in Fronta's list (queue set; a CRM without queues
// puts everyone in), in Fronta order when there is one.
const inFeed = (p) => p.queue !== null;
const feed = (people) => {
  const out = people.filter(inFeed);
  return out.some((p) => p.queue?.order != null) ? out.sort((a, b) => (a.queue?.order ?? Infinity) - (b.queue?.order ?? Infinity)) : out;
};
const findPerson = (id) => snapshotPeople().find((p) => p.id === decodeURIComponent(id));

// Server-Sent Events: the UI's live stream (see lib/events.js for the events).
const STREAM = ['snapshot', 'messages', 'requests', 'personal'];
function stream(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  const on = Object.fromEntries(STREAM.map((name) => [name, (data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)]));
  for (const name of STREAM) events.on(name, on[name]);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    for (const name of STREAM) events.off(name, on[name]);
  });
}

const readBody = async (req) => {
  let s = '';
  for await (const chunk of req) s += chunk;
  return s ? JSON.parse(s) : {};
};
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(await readFile(new URL('./public/index.html', import.meta.url)));
    }
    if (url.pathname === '/resolve.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return res.end(await readFile(new URL('./public/resolve.js', import.meta.url)));
    }
    if (url.pathname === '/api/templates') {
      if (req.method === 'POST') return json(res, 201, saveTemplate(null, await readBody(req)));
      return json(res, 200, listTemplates());
    }
    const t = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
    if (t) {
      const id = decodeURIComponent(t[1]);
      if (req.method === 'PUT') return json(res, 200, saveTemplate(id, await readBody(req)));
      if (req.method === 'DELETE') return deleteTemplate(id) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Template not found' });
    }
    if (url.pathname === '/api/status') {
      return json(res, 200, {
        people: crmSource(), email: emailConfigured(), whatsapp: whatsappConfigured(), smtp: smtpConfigured(),
      });
    }
    // AI requests: drafts waiting for the user (and their history).
    if (url.pathname === '/api/requests') {
      if (req.method === 'POST') {
        const { personIds = [], instruction = '', channel = null } = await readBody(req);
        return json(res, 202, ai.draft(personIds, instruction, { channel }));
      }
      return json(res, 200, ai.listForUi());
    }
    const r = url.pathname.match(/^\/api\/requests\/([^/]+)(?:\/(send|regenerate|cancel|recover))?$/);
    if (r && !r[2] && req.method === 'GET') {
      const one = ai.requestWithContext(decodeURIComponent(r[1]));
      return one ? json(res, 200, one) : json(res, 404, { error: 'Request not found' });
    }
    if (r && req.method !== 'GET') {
      const [, id, action] = r, body = await readBody(req);
      try {
        const out = action === 'send' ? await ai.approve(id, body)
          : action === 'regenerate' ? ai.regenerate(id, body.note, body.channel)
          : action === 'cancel' ? ai.cancel(id, body.note)
          : action === 'recover' ? ai.recover(id)
          : ai.editRequest(id, body);
        return out ? json(res, 200, out) : json(res, 409, { error: 'This request is no longer open' });
      } catch (e) { return json(res, e.status || 502, { error: e.message }); }
    }
    // Playbooks: the follow-up strategies, their change log (newest first) and the coach's state.
    if (url.pathname === '/api/playbooks') {
      return json(res, 200, { playbooks: listPlaybooks(), changes: listChanges().slice(-200).reverse(), coach: coachState() });
    }
    if (url.pathname === '/api/playbooks/build' && req.method === 'POST') {
      return json(res, 202, buildPlaybooks(snapshotPeople(), getSettings().styleGuide));
    }
    // Learn now from the decisions collected so far (otherwise every BATCH).
    if (url.pathname === '/api/playbooks/learn' && req.method === 'POST') return json(res, 202, learnNow());
    const u = url.pathname.match(/^\/api\/playbooks\/changes\/([^/]+)\/undo$/);
    if (u && req.method === 'POST') {
      const out = undoChange(decodeURIComponent(u[1]));
      return out.error ? json(res, 409, out) : json(res, 200, out.change);
    }
    const pbm = url.pathname.match(/^\/api\/playbooks\/([^/]+)$/);
    if (pbm && (req.method === 'PUT' || req.method === 'DELETE')) {
      const id = decodeURIComponent(pbm[1]), body = req.method === 'PUT' ? await readBody(req) : null;
      const op = body ? { op: 'setPlaybook', reason: 'Edited by the user', playbook: { ...body, id } } : { op: 'deletePlaybook', reason: 'Deleted by the user', id };
      return json(res, 200, applyOperations([op], { trigger: { kind: 'user' }, summary: body ? `Edited "${body.name || id}"` : `Deleted "${id}"`, merge: true }) ?? { unchanged: true });
    }
    // Personalization: the user's rules and facts, the AI's open questions, the
    // changes that touched rules (newest first), the coach's state.
    if (url.pathname === '/api/personal') {
      const changes = listChanges().filter((c) => c.ops.some((o) => o.op === 'setRule' || o.op === 'deleteRule')).slice(-100).reverse();
      return json(res, 200, { rules: listRules(), questions: openQuestions(), changes, coach: coachState(), past: pastDecisions().length,
        replay: listReplays().at(-1) ?? null, replayable: replayCases().length, fidelity: fidelity() });
    }
    if (url.pathname === '/api/personal/distill' && req.method === 'POST') return json(res, 202, distill());
    // Do the rules predict the user's past decisions? (with vs. without them)
    if (url.pathname === '/api/personal/replay' && req.method === 'POST') return json(res, 202, replay());
    const rm = url.pathname.match(/^\/api\/rules(?:\/([^/]+))?$/);
    if (rm && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
      const id = rm[1] && decodeURIComponent(rm[1]);
      if (req.method !== 'POST' && !getRule(id)) return json(res, 404, { error: 'Rule not found' });
      const body = req.method === 'DELETE' ? null : await readBody(req);
      const op = body ? { op: 'setRule', reason: 'By you', rule: { ...body, id: id ?? body.id } } : { op: 'deleteRule', reason: 'Deleted by you', id };
      const what = (body?.kind || getRule(id)?.kind) === 'fact' ? 'fact' : 'rule';
      const summary = !body ? `Deleted a ${what}` : !id ? `Added a ${what}` : body.status === 'rejected' ? `Rejected a ${what}` : `Edited a ${what}`;
      return json(res, 200, applyOperations([op], { trigger: { kind: 'user' }, summary, merge: true }) ?? { unchanged: true });
    }
    const qm = url.pathname.match(/^\/api\/questions\/([^/]+)\/(answer|skip)$/);
    if (qm && req.method === 'POST') {
      const id = decodeURIComponent(qm[1]);
      const out = qm[2] === 'skip' ? skipQuestion(id) : answerQuestion(id, await readBody(req));
      return out ? json(res, 200, out) : json(res, 409, { error: 'This question is no longer open' });
    }
    if (url.pathname === '/api/settings') {
      if (req.method === 'PUT') {
        const { model, draftPrompt, stylePrompt, coachPrompt, buildPrompt, styleGuide } = await readBody(req);
        saveSettings({ model, draftPrompt, stylePrompt, coachPrompt, buildPrompt, styleGuide });
      }
      return json(res, 200, { ...getSettings(), defaults: { draftPrompt: DRAFT_PROMPT, stylePrompt: STYLE_PROMPT, coachPrompt: COACH_PROMPT, buildPrompt: BUILD_PROMPT }, models: MODELS, learning: ai.learnState() });
    }
    if (url.pathname === '/api/settings/learn') {
      return json(res, 202, req.method === 'POST' ? ai.learnStyle() : ai.learnState());
    }
    if (url.pathname === '/api/refresh') {
      if (req.method === 'POST') refresh();
      return json(res, req.method === 'POST' ? 202 : 200, syncState());
    }
    // The feed without message bodies; history is fetched per person.
    if (url.pathname === '/api/people') {
      // lastSentAt / lastClientAt: the UI hides people already messaged today.
      return json(res, 200, feed(snapshotPeople()).map(({ messages = [], ...p }) => ({ ...p,
        lastSentAt: messages.findLast((m) => m.fromMe)?.at ?? null, lastClientAt: messages.findLast((m) => !m.fromMe)?.at ?? null })));
    }
    const m = url.pathname.match(/^\/api\/people\/([^/]+)\/history$/);
    if (m) {
      const person = findPerson(m[1]);
      if (!person) return json(res, 404, { error: 'Person not found' });
      // reach: where the composer can write (ai.channelsOf); waKnown: the number is on WhatsApp.
      const { messages, errors, ...rest } = person;
      return json(res, 200, { person: rest, messages, errors, reach: ai.channelsOf(person), waKnown: person.phones.some(whatsappKnown) });
    }
    // Messages: every contact with a conversation, newest first, with unread counts.
    if (url.pathname === '/api/chats') return json(res, 200, chatList(snapshotPeople()));
    const c = url.pathname.match(/^\/api\/chats\/([^/]+)\/(read|unread)$/);
    if (c && req.method === 'POST') {
      const person = findPerson(c[1]);
      if (!person) return json(res, 404, { error: 'Person not found' });
      return json(res, 200, c[2] === 'read' ? { id: person.id, readAt: markRead(person) } : { id: person.id, markedAt: markUnread(person) });
    }
    if (url.pathname === '/api/events') return stream(req, res);
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
}).listen(PORT, () => {
  console.log(`Outreach running at http://localhost:${PORT}`);
  refresh(); // the restored snapshot keeps serving meanwhile
  startLive();
});
