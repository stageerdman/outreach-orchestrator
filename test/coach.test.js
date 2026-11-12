import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'outreach-coach-'));
process.env.OUTREACH_DATA_DIR = dir;
process.env.TEMPLATES_IMPORT = '';
const coach = await import('../lib/coach.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const m = (at, fromMe, channel = 'whatsapp') => ({ channel, at, fromMe, text: 'x' });

test('follow-up stats: touches since the client last wrote, replies within 7 days', () => {
  const people = [{ stage: { label: 'Answered' }, messages: [
    m('2026-11-01T10:00:00Z', true), m('2026-11-01T10:10:00Z', true), // one touch
    m('2026-11-03T10:00:00Z', true, 'email'),
    m('2026-11-04T10:00:00Z', false), // replies to touch 2
    m('2026-11-05T10:00:00Z', true), // touch 1 again, never answered
  ] }];
  const s = coach.followupStats(people);
  assert.ok(s.includes('All: 1/3 (33%)'), s); // the reply counts for touch 2 only
  assert.ok(s.includes('- 1: 0/2 (0%)') && s.includes('- 2: 1/1 (100%)'), s);
  assert.ok(s.includes('- Email: 1/1 (100%)') && s.includes('- WhatsApp: 0/2 (0%)'), s);
});

test('the learning input shows the decision, the note, the edit and what the AI saw', () => {
  const r = { id: 'r', kind: 'message', channel: 'whatsapp', playbookId: 'na', stepId: 's2', templateId: 't', reasoning: 'nudge',
    aiText: 'Dobrý den, už jste se rozhodl?', text: 'Dobrý den, jak to vypadá?', subject: '', note: '',
    context: { stage: 'Answered', task: { kind: 'call', note: 'x' }, followup: { followups: 2 }, messages: [{ ...m('2026-11-01T10:00:00Z', false), text: 'Ozvu se' }] } };
  const s = coach.learnInput(r, 'approve');
  assert.ok(s.includes('The user edited the draft before sending'));
  assert.ok(s.includes('<ai>Dobrý den, už jste se rozhodl?</ai>') && s.includes('<sent>Dobrý den, jak to vypadá?</sent>'));
  assert.ok(s.includes('playbook="na" step="s2"'));
  assert.ok(s.includes('Messages sent since the client last wrote: 2'));
  assert.ok(s.includes('[2026-11-01 10:00 · WhatsApp · CLIENT]\nOzvu se'));
  const c = coach.learnInput({ ...r, text: r.aiText, note: 'too pushy' }, 'cancel');
  assert.ok(c.includes('cancelled this draft') && c.includes('The user\'s note: "too pushy"') && !c.includes('<ai>'));
  assert.ok(coach.learnInput({ ...r, text: r.aiText }, 'approve').includes('Sent as the AI wrote it.'));
});

test('the operations schema allows at most 10 steps and only known stages', () => {
  const pb = coach.OPS_SCHEMA.properties.operations.items.properties.playbook.anyOf[0];
  assert.equal(pb.properties.steps.maxItems, 10);
  assert.ok(pb.properties.stages.items.enum.includes('No show'));
});
