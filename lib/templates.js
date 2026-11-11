// Message templates: { id, name, subject, bodyHtml, createdAt, updatedAt },
// kept in templates.json next to the cache (user data, never in the repo).
// The first run imports the MenuBarTemplates app's templates, if there are any.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir } from './cache.js';

const IMPORT = join(homedir(), 'Library/Application Support/MenuBarTemplates/templates.json');
const file = () => join(dataDir(), 'templates.json');

function read(path) {
  return JSON.parse(readFileSync(path, 'utf8')).templates ?? [];
}
function write(templates) {
  const tmp = file() + '.tmp';
  writeFileSync(tmp, JSON.stringify({ templates }, null, 2), { mode: 0o600 });
  renameSync(tmp, file());
}

export function listTemplates(importFrom = process.env.TEMPLATES_IMPORT ?? IMPORT) {
  if (existsSync(file())) return read(file());
  const imported = importFrom && existsSync(importFrom) ? read(importFrom) : [];
  write(imported);
  return imported;
}

// Creates or replaces one template; only the editable fields are taken.
export function saveTemplate(id, { name = '', subject = '', bodyHtml = '' }) {
  const all = listTemplates(), now = new Date().toISOString();
  const i = all.findIndex((t) => t.id === id);
  const t = { id: id || randomUUID(), name: String(name), subject: String(subject), bodyHtml: String(bodyHtml),
    createdAt: all[i]?.createdAt ?? now, updatedAt: now };
  if (i < 0) all.push(t); else all[i] = t;
  write(all);
  return t;
}

export function deleteTemplate(id) {
  const all = listTemplates(), rest = all.filter((t) => t.id !== id);
  write(rest);
  return rest.length < all.length;
}
