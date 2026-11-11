import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { listPeople, getPerson, crmSource } from './lib/crm.js';
import { emailHistory, emailConfigured } from './lib/email.js';
import { whatsappHistory, whatsappConfigured } from './lib/whatsapp.js';

const PORT = Number(process.env.PORT || 3000);

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function history(person) {
  const errors = {};
  const [email, whatsapp] = await Promise.all([
    emailHistory(person.emails).catch((e) => ((errors.email = e.message), [])),
    Promise.resolve().then(() => whatsappHistory(person.phones))
      .catch((e) => ((errors.whatsapp = e.message), [])),
  ]);
  const messages = [...email, ...whatsapp].sort((a, b) => a.at.localeCompare(b.at));
  return { person, messages, errors };
}

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
    if (url.pathname === '/api/people') {
      return json(res, 200, await listPeople({ fresh: url.searchParams.has('fresh') }));
    }
    const m = url.pathname.match(/^\/api\/people\/([^/]+)\/history$/);
    if (m) {
      const person = await getPerson(decodeURIComponent(m[1]));
      if (!person) return json(res, 404, { error: 'Person not found' });
      return json(res, 200, await history(person));
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`Outreach running at http://localhost:${PORT}`));
