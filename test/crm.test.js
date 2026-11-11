import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get, normalize } from '../lib/crm.js';

test('get reads dot paths and tolerates missing parts', () => {
  const o = { contact: { email: 'a@x.com' } };
  assert.equal(get(o, 'contact.email'), 'a@x.com');
  assert.equal(get(o, 'contact.phone.mobile'), undefined);
  assert.equal(get(o, 'nope.deeper'), undefined);
});

test('normalize accepts string or list emails/phones and cleans them', () => {
  const p = normalize({ id: 7, name: 'Ana', email: [' Ana@X.com ', ''], phone: '+63 900 000 0001' });
  assert.deepEqual(p, { id: '7', name: 'Ana', company: '', emails: ['ana@x.com'], phones: ['+63 900 000 0001'] });
  assert.deepEqual(normalize({ id: 1 }).emails, []);
});

test('normalize falls back to email, then phone, for the name', () => {
  assert.equal(normalize({ id: 1, email: 'b@x.com' }).name, 'b@x.com');
  assert.equal(normalize({ id: 1, phone: '+1 555' }).name, '+1 555');
  assert.equal(normalize({ id: 1 }).name, 'Unknown');
});

test('normalize follows CRM_*_FIELD mappings', (t) => {
  process.env.CRM_EMAIL_FIELD = 'contact.emails';
  process.env.CRM_NAME_FIELD = 'full_name';
  t.after(() => { delete process.env.CRM_EMAIL_FIELD; delete process.env.CRM_NAME_FIELD; });
  const p = normalize({ id: 2, full_name: 'Bo', contact: { emails: ['bo@x.com', 'BO@y.com'] } });
  assert.equal(p.name, 'Bo');
  assert.deepEqual(p.emails, ['bo@x.com', 'bo@y.com']);
});
