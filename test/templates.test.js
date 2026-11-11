import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { placeholders, hasGender, resolve, htmlToText } from '../public/resolve.js';

const dir = mkdtempSync(join(tmpdir(), 'outreach-tpl-'));
process.env.OUTREACH_DATA_DIR = dir;
const store = await import('../lib/templates.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('placeholders are found once each, in order, across subject and body', () => {
  assert.deepEqual(placeholders('Ahoj {{ JMENO }}', '<p>{{JMENO}} v {{&nbsp;DEN }} <b>{{ GOOGLE MEET LINK }}</b> {{ lower }}</p>'),
    ['JMENO', 'DEN', 'GOOGLE MEET LINK']);
  assert.deepEqual(placeholders('{{ ČAS }}', ''), ['ČAS']);
});

test('resolve fills values, removes excluded fields and keeps empty ones', () => {
  const v = { JMENO: { value: 'Jan', include: true }, DEN: { value: '', include: true }, CAS: { value: 'x', include: false } };
  assert.equal(resolve('{{ JMENO }}, {{ DEN }} {{CAS}}!', v), 'Jan, {{ DEN }} !');
  assert.equal(resolve('{{ JMENO }}', { JMENO: { value: 'A&B' } }, 'female', true), 'A&amp;B');
});

test('gender blocks pick the male or female text', () => {
  assert.ok(hasGender('', 'Byl{{gender:|a}} jsi'));
  assert.ok(!hasGender('{{ JMENO }}', ''));
  assert.equal(resolve('Byl{{gender:|a}} jsi', {}, 'female'), 'Byla jsi');
  assert.equal(resolve('Byl{{gender:|a}} jsi', {}, 'male'), 'Byl jsi');
});

test('html to plain text keeps line breaks and list items', () => {
  assert.equal(htmlToText('<p>Ahoj&nbsp;Jane,</p><p>a<br>b</p><ul><li>one</li><li>two</li></ul>'), 'Ahoj Jane,\na\nb\n• one\n• two');
});

test('first run imports templates, then saves and deletes', () => {
  const src = join(dir, 'import.json');
  writeFileSync(src, JSON.stringify({ templates: [{ id: 'a', name: 'A', subject: 's', bodyHtml: 'b', createdAt: 'c', updatedAt: 'u' }] }));
  assert.equal(store.listTemplates(src).length, 1);
  assert.equal(store.listTemplates(join(dir, 'other.json')).length, 1); // imported only once
  const t = store.saveTemplate(null, { name: 'New', subject: 'x', bodyHtml: '<p>y</p>', id: 'ignored' });
  assert.ok(t.id && t.createdAt);
  assert.equal(store.saveTemplate('a', { name: 'A2' }).createdAt, 'c');
  assert.deepEqual(store.listTemplates().map((x) => x.name), ['A2', 'New']);
  assert.ok(store.deleteTemplate('a'));
  assert.ok(!store.deleteTemplate('a'));
  assert.equal(store.listTemplates().length, 1);
});
