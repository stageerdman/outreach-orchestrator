// What each connection gave the AI and what went out through it, for the
// Connections view ("what does the AI actually get?"). In connlog.json (app
// data, never the repo — it holds real message content): { [connectionId]:
// { toAI: [entry], out: [entry] } }, newest first, the last KEEP of each.
// entry = { at, person, purpose ('draft' | 'copilot' | 'send'), text, subject? }.
import { readData, writeData } from './cache.js';
import { events } from './events.js';

const KEEP = 10, CLIP = 6000;
let all;
const load = () => (all ??= readData('connlog', {}));
export function logConnection(id, dir, entry) {
  const c = (load()[id] ??= { toAI: [], out: [] });
  const text = entry.text?.length > CLIP ? `${entry.text.slice(0, CLIP)} …` : entry.text;
  c[dir] = [{ at: new Date().toISOString(), ...entry, text }, ...(c[dir] || [])].slice(0, KEEP);
  writeData('connlog', all);
  events.emit('connlog', { id, dir });
}
export const connectionLog = (id) => ({ toAI: [], out: [], ...load()[id] });
