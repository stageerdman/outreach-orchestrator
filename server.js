import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { crmSource } from './lib/crm.js';
import { emailConfigured } from './lib/email.js';
import { whatsappConfigured } from './lib/whatsapp.js';
import { refresh, syncState, snapshotPeople, restoreSnapshot } from './lib/sync.js';

const PORT = Number(process.env.PORT || 3000);
restoreSnapshot();

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
    if (url.pathname === '/api/status') {
      return json(res, 200, {
        people: crmSource(), email: emailConfigured(), whatsapp: whatsappConfigured(),
      });
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
