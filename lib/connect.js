// The Connections chat: Claude Code with full permissions in this repo, so it
// can build a new connection (a calendar, a CRM, …) by talking it through with
// the user. One conversation at a time, one CLI turn per message
// (`claude -p --output-format stream-json`, `--session-id` first, then
// `--resume`), streamed into a transcript kept in connect.json (app data):
// { sessionId, startedAt, items: [{ id, kind: user|ai|tool|error|note, text, at }] }.
// Every change emits `connect` (SSE).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readData, writeData } from './cache.js';
import { events } from './events.js';

const BIN = process.env.CLAUDE_BIN || 'claude';
export const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const TIMEOUT = 30 * 60_000;

export const CONNECT_PROMPT = `You are the connection builder inside Outreach Orchestrator, the app in the current directory. The user runs it for their sales outreach; they are not a developer and chat with you from the app's Connections section. They want the app (and its AI that drafts messages) connected to something new — a calendar to see and book meetings, another inbox, a tool they use.

How to work:
- First understand what they want it to do and where the thing lives (which calendar app/account, how they log in). Ask ONE short question at a time, in plain words, no jargon; offer the likely options ("Google Calendar, iCloud or Outlook?"). Don't ask what you can find out yourself.
- Prefer the simplest access that works for them (an official API with a key or OAuth, a local app, an existing MCP server or CLI). Before installing anything or creating accounts/keys, say in one line what and why.
- Secrets (API keys, passwords, tokens): never ask for them in the chat. When you need one, explain in one line where the user finds it, then end your message with a line exactly like
  [[secret GOOGLE_CALENDAR_KEY: the API key from your Google Cloud project]]
  and stop. The app shows a secure field and writes the value into .env itself; you'll get back "[GOOGLE_CALENDAR_KEY saved to .env]". Use process.env.NAME in the code. Never print, quote or summarise values from .env. If the user pastes a secret into the chat anyway, move it into .env and just say it's saved.
- Secrets go in .env only, never in git.
- Follow CLAUDE.md: a new source is its own lib/<name>.js with the same small interface; tests in test/ with node --test; run npm test; commit and push each focused change. Never commit private data (messages, CRM exports). The CRM and the WhatsApp bridge DB stay read-only unless the user explicitly asks for writing to that exact thing.
- Register every new connection in lib/connections.js (CONNECTIONS: id, name, what, flow — 'in' if Outreach only reads from it, 'out' if it only writes/sends to it, 'both' — and status) so it shows in the Connections diagram. If the user wants the drafting AI to use it (e.g. offer real free slots, book meetings), wire it into lib/assistant.js too, and say what the AI will now do.
- Keep replies short. While working, don't narrate every step (the app shows your steps). When done, say in 2–3 plain sentences what now works, how to try it, and whether Outreach needs a restart (quit and reopen it) — it does after any server code change.`;

let convo, child = null;
const load = () => (convo ??= readData('connect', null) ?? fresh());
const fresh = () => ({ sessionId: null, startedAt: null, items: [] });
const save = () => { writeData('connect', convo); events.emit('connect', { running: Boolean(child) }); };
const add = (kind, text, extra = {}) => { load().items.push({ id: randomUUID(), kind, text, ...extra, at: new Date().toISOString() }); save(); };

export const getConversation = () => ({ ...load(), running: Boolean(child) });

const short = (s = '', n = 90) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const rel = (p = '') => (p.startsWith(REPO) ? relative(REPO, p) || '.' : p);
// One plain line per tool use ({ text, detail: the raw path/command }); null = not worth showing.
const base = (p = '') => p.split('/').filter(Boolean).at(-1) || p;
export function toolLine(name, input = {}) {
  const path = rel(input.file_path || input.notebook_path || input.path || ''), cmd = String(input.command || '');
  const t = (text, detail = '') => ({ text, detail });
  switch (name) {
    case 'Read': return t(`Reading ${base(path)}`, path);
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': case 'Write': return t(`Changing ${base(path)}`, path);
    case 'Grep': case 'Glob': return t('Looking through the code', short(input.pattern, 80));
    case 'Bash':
      if (/\b(npm (run )?test|node --test)\b/.test(cmd)) return t('Running tests', short(cmd, 200));
      if (/\bgit (commit|push)\b/.test(cmd)) return t('Saving the change', short(cmd, 200));
      { const m = cmd.match(/\b(?:npm (?:install|i)|brew install|pip3? install|npx)\s+((?:-\S+\s+)*)([^\s;&|]+)/);
        if (m) return t(`Installing ${m[2]}`, short(cmd, 200)); }
      return t(input.description ? short(input.description, 70) : 'Running a command', short(cmd, 200));
    case 'WebFetch': return t('Reading a web page', short(input.url, 200));
    case 'WebSearch': return t('Searching the web', short(input.query, 200));
    case 'Task': case 'Agent': return t(short(input.description, 70) || 'Working', '');
    case 'TodoWrite': case 'ToolSearch': return null;
    default: return t('Working', name);
  }
}

// One stream-json line → transcript items.
export function onEvent(e) {
  if (e.type === 'assistant') {
    for (const c of e.message?.content ?? []) {
      if (c.type === 'text' && c.text.trim()) add('ai', c.text.trim());
      else if (c.type === 'tool_use') { const l = toolLine(c.name, c.input); if (l) add('tool', l.text, { detail: l.detail }); }
    }
  } else if (e.type === 'result' && e.is_error) add('error', short(e.result || e.subtype || 'Claude stopped with an error', 300));
}

export const connectArgs = (sessionId, first) => ['-p', '--output-format', 'stream-json', '--verbose',
  '--dangerously-skip-permissions', '--append-system-prompt', CONNECT_PROMPT, first ? '--session-id' : '--resume', sessionId];

// Sends the user's message; resolves when the turn ends. Throws while one runs.
export function say(text) {
  text = String(text ?? '').trim();
  if (!text) throw new Error('Nothing to send');
  if (child) throw new Error('Still working on the last message');
  const c = load(), first = !c.sessionId;
  if (first) { c.sessionId = randomUUID(); c.startedAt = new Date().toISOString(); }
  add('user', text);
  return new Promise((resolve) => {
    const p = child = spawn(BIN, connectArgs(c.sessionId, first), { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', err = '', ended = false;
    const timer = setTimeout(() => { add('error', 'Stopped after 30 minutes.'); p.kill(); }, TIMEOUT);
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const e = JSON.parse(line); if (e.type === 'result') ended = true; onEvent(e); } catch { /* not JSON */ }
      }
    });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => add('error', e.code === 'ENOENT' ? `Claude Code not found (${BIN}); set CLAUDE_BIN` : e.message));
    p.on('close', (code, signal) => {
      clearTimeout(timer); child = null;
      if (signal === 'SIGTERM' && p.stopped) add('note', 'Stopped.');
      else if (!ended && code) add('error', short(err.trim() || `Claude exited (${code})`, 300));
      else save();
      resolve();
    });
    p.stdin.end(text);
  });
}

export function stop() {
  if (!child) return false;
  child.stopped = true; child.kill('SIGTERM');
  return true;
}

// A new conversation (the old one is dropped; its code changes stay).
export function reset() {
  if (child) throw new Error('Stop it first');
  convo = fresh(); save();
  return getConversation();
}

// A secret the AI asked for ([[secret NAME: …]]) goes straight into the repo's
// .env (and this process), never into the chat; the AI is told only that it's saved.
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
export function envWith(text, name, value) {
  if (!SECRET_NAME.test(name)) throw new Error('Not a valid setting name');
  if (/[\r\n]/.test(value) || !value) throw new Error('The value must be one line');
  if (/[\s#"'\\`$]/.test(value) && value.includes("'")) throw new Error("The value can't contain both spaces and '");
  const line = `${name}=${/[\s#"'\\`$]/.test(value) ? `'${value}'` : value}`;
  const lines = text ? text.replace(/\n$/, '').split('\n') : [];
  const i = lines.findIndex((l) => l.replace(/^export\s+/, '').startsWith(`${name}=`));
  if (i >= 0) lines[i] = line; else lines.push(line);
  return lines.join('\n') + '\n';
}
export function saveSecret(name, value, envFile = `${REPO}/.env`) {
  value = String(value ?? '').trim();
  writeFileSync(envFile, envWith(existsSync(envFile) ? readFileSync(envFile, 'utf8') : '', name, value), { mode: 0o600 });
  process.env[name] = value;
  if (!child) say(`[${name} saved to .env]`);
  return { name, saved: true };
}
