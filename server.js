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
import { getMind, addNote, removeNote, refreshMind, maybeRefresh, maybeAsk, askQuestions, closeQuestion, staleness } from './lib/mind.js';
import { buildPlaybooks, coachState, learnNow, fidelity, migrateLessons, makeGeneral } from './lib/coach.js';
import { listRules, getRule } from './lib/rules.js';
import { scenarioOf } from './lib/scenario.js';
import * as ai from './lib/assistant.js';
import { listConnections } from './lib/connections.js';
import * as connect from './lib/connect.js';
import * as copilot from './lib/copilot.js';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 3000);
// The portrait without the research notes (large; kept in mind.json).
const mindForUi = () => { const { research, ...m } = getMind(); return m; };
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
const STREAM = ['snapshot', 'messages', 'requests', 'personal', 'connect', 'copilot', 'playbooks'];
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

const SHARED = ['/resolve.js', '/sent.js'];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(await readFile(new URL('./public/index.html', import.meta.url)));
    }
    // The modules shared by the UI and the server (index.html imports them).
    if (SHARED.includes(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return res.end(await readFile(new URL(`./public${url.pathname}`, import.meta.url)));
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
        const { personIds = [], instruction = '', channel = null, templateId = null } = await readBody(req);
        return json(res, 202, ai.draft(personIds, instruction, { channel, templateId }));
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
    // Copilot: per person, a chat with the drafting AI (lib/copilot.js); a turn streams over SSE `copilot`.
    const cp = url.pathname.match(/^\/api\/copilot\/([^/]+)(?:\/(stop))?$/);
    if (cp) {
      const id = decodeURIComponent(cp[1]);
      try {
        if (cp[2]) return req.method === 'POST' ? json(res, 200, { stopped: copilot.stop(id) }) : json(res, 405, { error: 'POST only' });
        if (req.method === 'POST') { copilot.say(id, (await readBody(req)).text); return json(res, 202, copilot.getCopilot(id)); }
        if (req.method === 'DELETE') return json(res, 200, copilot.clear(id));
        return json(res, 200, copilot.getCopilot(id));
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
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
    // "Make it the rule": a lesson the coach kept for one chat goes back as general.
    const lg = url.pathname.match(/^\/api\/playbooks\/learnlog\/([^/]+)\/([^/]+)\/general$/);
    if (lg && req.method === 'POST') {
      try { return json(res, 202, makeGeneral(decodeURIComponent(lg[1]), decodeURIComponent(lg[2]))); }
      catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
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
    // Personalization: the portrait of how the user thinks (lib/mind.js), the
    // facts about the offer, how often drafts go out as written.
    if (url.pathname === '/api/personal') {
      return json(res, 200, { mind: mindForUi(), facts: listRules().filter((r) => r.kind === 'fact'), fidelity: fidelity(), stale: staleness() });
    }
    // Rebuild the portrait and test it; or tell it something in your own words (rebuilds).
    if (url.pathname === '/api/mind/build' && req.method === 'POST') { refreshMind(snapshotPeople()); return json(res, 202, mindForUi()); }
    const nm = url.pathname.match(/^\/api\/mind\/notes\/([^/]+)$/);
    if (nm && req.method === 'DELETE') return removeNote(decodeURIComponent(nm[1])) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Note not found' });
    if (url.pathname === '/api/mind/notes' && req.method === 'POST') {
      const note = addNote((await readBody(req)).text);
      if (!note) return json(res, 400, { error: 'Write something first' });
      refreshMind(snapshotPeople());
      return json(res, 202, mindForUi());
    }
    // The AI's questions about your thinking: answer (a suggested answer and/or
    // your words) or skip; the last one of a set with answers rebuilds the portrait.
    const qm = url.pathname.match(/^\/api\/mind\/questions\/([^/]+)\/(answer|skip)$/);
    if (qm && req.method === 'POST') {
      const body = qm[2] === 'answer' ? await readBody(req) : {};
      const out = closeQuestion(decodeURIComponent(qm[1]), { ...body, skip: qm[2] === 'skip' });
      if (!out) return json(res, 409, { error: qm[2] === 'answer' ? 'Pick an answer or write one' : 'This question is no longer open' });
      if (out.done) refreshMind(snapshotPeople());
      return json(res, 200, mindForUi());
    }
    if (url.pathname === '/api/mind/questions' && req.method === 'POST') { askQuestions(snapshotPeople()); return json(res, 202, mindForUi()); }
    // Facts about the offer (rules.json, kind "fact"): add, edit, delete; logged and undoable.
    const rm = url.pathname.match(/^\/api\/rules(?:\/([^/]+))?$/);
    if (rm && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
      const id = rm[1] && decodeURIComponent(rm[1]);
      if (req.method !== 'POST' && !getRule(id)) return json(res, 404, { error: 'Rule not found' });
      const body = req.method === 'DELETE' ? null : await readBody(req);
      const op = body ? { op: 'setRule', reason: 'By you', rule: { ...body, kind: 'fact', id: id ?? body.id } } : { op: 'deleteRule', reason: 'Deleted by you', id };
      const summary = !body ? 'Deleted a fact' : !id ? 'Added a fact' : 'Edited a fact';
      return json(res, 200, applyOperations([op], { trigger: { kind: 'user' }, summary, merge: true }) ?? { unchanged: true });
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
      // reach: where the AI can write (ai.channelsOf); waKnown: the number is on WhatsApp;
      // scenario: where the chat is in the playbooks (lib/scenario.js), for the scenario line.
      const { messages, errors, ...rest } = person;
      return json(res, 200, { person: rest, messages, errors, reach: ai.channelsOf(person), waKnown: person.phones.some(whatsappKnown), scenario: scenarioOf(person) });
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
    // Connections: what the orchestrator is wired to, and the chat that adds more.
    if (url.pathname === '/api/connections') return json(res, 200, listConnections({ people: snapshotPeople(), errors: syncState().errors ?? {} }));
    if (url.pathname === '/api/connect') {
      if (req.method !== 'POST') return json(res, 200, connect.getConversation());
      const { text } = await readBody(req);
      try { connect.say(text); } catch (e) { return json(res, 409, { error: e.message }); }
      return json(res, 202, connect.getConversation());
    }
    const k = url.pathname.match(/^\/api\/connect\/(stop|reset|secret)$/);
    if (k && req.method === 'POST') {
      const body = await readBody(req);
      try {
        if (k[1] === 'stop') return json(res, 200, { stopped: connect.stop() });
        if (k[1] === 'reset') return json(res, 200, connect.reset());
        return json(res, 200, connect.saveSecret(body.name, body.value));
      } catch (e) { return json(res, 409, { error: e.message }); }
    }
    if (url.pathname === '/api/restart' && req.method === 'POST') { json(res, 202, { restarting: true }); return restart(); }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});
// Restart to load new code: the Mac app (OUTREACH_SUPERVISED) starts the server
// again when it exits with 75; otherwise it starts a copy of itself first.
function restart() {
  connect.stop();
  setTimeout(() => {
    if (process.env.OUTREACH_SUPERVISED) process.exit(75);
    spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { cwd: process.cwd(), detached: true, stdio: 'inherit', env: { ...process.env, OUTREACH_RESTARTED: '1' } }).unref();
    process.exit(0);
  }, 200);
}
// After a restart the old process may still hold the port for a moment.
let tries = 0;
server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE' || ++tries > 20) throw e;
  setTimeout(() => server.listen(PORT), 250);
});
server.listen(PORT, () => {
  console.log(`Outreach running at http://localhost:${PORT}`);
  refresh(); // the restored snapshot keeps serving meanwhile
  startLive();
  // The portrait keeps itself current: built when missing, rebuilt and re-tested
  // when enough new material came in (checked after the first refresh, then hourly).
  const mind = () => maybeRefresh(snapshotPeople()).then(() => maybeAsk(snapshotPeople())).catch((e) => console.error('mind:', e.message));
  setTimeout(mind, 3 * 60_000);
  setInterval(mind, 60 * 60_000);
});
