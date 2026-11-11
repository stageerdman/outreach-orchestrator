import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'outreach-pb-'));
process.env.OUTREACH_DATA_DIR = dir;
process.env.TEMPLATES_IMPORT = '';
const pb = await import('../lib/playbooks.js');
const { listTemplates, saveTemplate } = await import('../lib/templates.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const base = {
  id: 'Not answered — calls', name: 'Not answered', stages: ['Not answered', 'Nope'], situation: 'no-reply', goal: 'Get a reply',
  steps: [{ id: 's1', channel: 'whatsapp', waitDays: 1, ask: 'Can I reach you here?', why: 'Easy yes/no', templateIds: ['t1', 'gone'] }],
  responses: [{ when: 'no time', approach: 'Offer a later slot', templateIds: [] }],
};

test('a playbook is cleaned: slug id, known stages, channels and templates, at most 10 steps', () => {
  const p = pb.cleanPlaybook({ ...base, steps: [...Array(12)].map((_, i) => ({ id: 'x', channel: 'sms', waitDays: '2.6', ask: `a${i}` })) }, new Set(['t1']));
  assert.equal(p.id, 'not-answered-calls');
  assert.deepEqual(p.stages, ['Not answered']);
  assert.equal(p.steps.length, pb.MAX_STEPS);
  assert.deepEqual(p.steps.slice(0, 3).map((s) => s.id), ['x', 'x-2', 'x-3']);
  assert.equal(p.steps[0].channel, 'any');
  assert.equal(p.steps[0].waitDays, 3);
  const q = pb.cleanPlaybook(base, new Set(['t1']));
  assert.deepEqual(q.steps[0].templateIds, ['t1']);
  assert.equal(q.responses[0].id, 'no-time');
});

test('operations are applied as one logged change, templates first so steps can use them', () => {
  const c = pb.applyOperations([
    { op: 'setPlaybook', reason: 'new path', playbook: { ...base, steps: [{ ...base.steps[0], templateIds: ['tpl-new'] }] } },
    { op: 'setTemplate', reason: 'reusable', template: { id: 'tpl-new', name: 'NA1 WA', body: 'Dobrý den,\nzastihnu Vás tady?' } },
  ], { trigger: { kind: 'cancel', requestId: 'r1', note: 'too pushy' }, summary: 'Softer first step' });
  const t = listTemplates().find((x) => x.name === 'NA1 WA');
  assert.ok(t, 'template created');
  assert.ok(t.bodyHtml.includes('<div>zastihnu Vás tady?</div>'));
  assert.equal(c.ops.length, 2);
  assert.equal(c.trigger.note, 'too pushy');
  assert.equal(t.id, 'tpl-new');
  assert.deepEqual(pb.getPlaybook('not-answered-calls').steps[0].templateIds, ['tpl-new']);
  assert.equal(pb.applyOperations([{ op: 'setPlaybook', playbook: pb.getPlaybook('not-answered-calls') }]), null, 'no-op is not logged');
});

test('undo restores templates and playbooks, and refuses when changed again since', () => {
  const t = saveTemplate('', { name: 'Old', subject: '', bodyHtml: 'old text' });
  const c1 = pb.applyOperations([{ op: 'setTemplate', template: { id: t.id, body: 'new text' } }]);
  assert.equal(listTemplates().find((x) => x.id === t.id).bodyHtml, '<div>new text</div>');
  const c2 = pb.applyOperations([{ op: 'setTemplate', template: { id: t.id, body: 'newer' } }]);
  assert.match(pb.undoChange(c1.id).error, /undo the later change first/);
  assert.ok(pb.undoChange(c2.id).change);
  assert.ok(pb.undoChange(c1.id).change);
  assert.equal(listTemplates().find((x) => x.id === t.id).bodyHtml, 'old text');
  assert.equal(pb.undoChange(c1.id).error, 'Already undone');

  const c3 = pb.applyOperations([{ op: 'deletePlaybook', id: 'not-answered-calls' }]);
  assert.equal(pb.getPlaybook('not-answered-calls'), undefined);
  pb.undoChange(c3.id);
  assert.ok(pb.getPlaybook('not-answered-calls'));
});

test('playbooks render compactly for prompts, with steps, why, templates and lessons', () => {
  saveTemplate('T9', { name: 'Nine', subject: '', bodyHtml: 'x' });
  pb.applyOperations([{ op: 'setPlaybook', playbook: { ...base, id: 'u', name: 'Universal', stages: [], steps: [{ id: 'a', channel: 'email', waitDays: 3, ask: 'Still relevant?', why: 'Breakup', templateIds: ['T9'] }], lessons: ['No calendar links before they reply'] } }]);
  const s = pb.renderPlaybooks([pb.getPlaybook('u')]);
  assert.ok(s.includes('## u · Universal\nStages: any · situation: no-reply'));
  assert.ok(s.includes('1. [a] email, after 3 day(s): Still relevant? — why: Breakup [templates: T9 "Nine"]'));
  assert.ok(s.includes('Lessons:\n- No calendar links before they reply'));
});
