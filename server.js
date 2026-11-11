import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { crmSource } from './lib/crm.js';
import { emailConfigured, smtpConfigured } from './lib/email.js';
import { whatsappConfigured } from './lib/whatsapp.js';
import { listTemplates, saveTemplate, deleteTemplate } from './lib/templates.js';
import { refresh, syncState, snapshotPeople, restoreSnapshot } from './lib/sync.js';
import { getSettings, saveSettings, DRAFT_PROMPT, STYLE_PROMPT, COACH_PROMPT, BUILD_PROMPT, MODELS } from './lib/settings.js';
import { listPlaybooks, listChanges, applyOperations, undoChange } from './lib/playbooks.js';
import { buildPlaybooks, coachState } from './lib/coach.js';
import * as ai from './lib/assistant.js';

const PORT = Number(process.env.PORT || 3000);
restoreSnapshot();

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
        const { personIds = [], instruction = '' } = await readBody(req);
        return json(res, 202, ai.draft(personIds, instruction));
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
          : action === 'regenerate' ? ai.regenerate(id, body.note)
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
    // The list without message bodies; history is fetched per person on expand.
    if (url.pathname === '/api/people') {
      return json(res, 200, snapshotPeople().map(({ messages, ...p }) => p));
    }
    const m = url.pathname.match(/^\/api\/people\/([^/]+)\/history$/);
    if (m) {
      const person = snapshotPeople().find((p) => p.id === decodeURIComponent(m[1]));
      if (!person) return json(res, 404, { error: 'Person not found' });
      const { messages, errors, ...rest } = person;
      return json(res, 200, { person: rest, messages, errors });
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`Outreach running at http://localhost:${PORT}`));
