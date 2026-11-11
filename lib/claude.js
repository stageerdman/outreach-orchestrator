// Claude Code headless (`claude -p`) with the user's own login, for one
// structured answer per call: no tools, no MCP, no saved session. Runs from
// the app data folder so no project CLAUDE.md is picked up. At most MAX at once.
import { spawn } from 'node:child_process';
import { dataDir } from './cache.js';

const BIN = process.env.CLAUDE_BIN || 'claude';
const MAX = 2, TIMEOUT = 5 * 60_000;
let running = 0;
const queue = [];

function next() {
  if (running >= MAX || !queue.length) return;
  running++;
  const { args, input, timeout, resolve, reject } = queue.shift();
  run(args, input, timeout).then(resolve, reject).finally(() => { running--; next(); });
}

function run(args, input, timeout = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, args, { cwd: dataDir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error(`Claude took longer than ${timeout / 60_000} minutes`)); }, timeout);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? `Claude Code not found (${BIN}); set CLAUDE_BIN` : e.message)); });
    p.on('close', () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out);
        if (r.is_error) return reject(new Error(r.result || r.subtype || 'Claude failed'));
        resolve(r.structured_output ?? JSON.parse(r.result));
      } catch { reject(new Error((err || out).trim().slice(0, 300) || 'Claude returned nothing')); }
    });
    p.stdin.end(input);
  });
}

export const claudeArgs = ({ system, schema, model }) => [
  '-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
  '--system-prompt', system, '--json-schema', JSON.stringify(schema), ...(model ? ['--model', model] : []),
];

// Resolves to the object matching `schema`.
export function askClaude({ system, prompt, schema, model, timeout }) {
  return new Promise((resolve, reject) => {
    queue.push({ args: claudeArgs({ system, schema, model }), input: prompt, timeout, resolve, reject });
    next();
  });
}
