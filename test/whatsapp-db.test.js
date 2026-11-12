// The bridge DB side, against temp SQLite files shaped like the bridge's
// (messages.db + whatsapp.db's lid map) and a fake bridge HTTP server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const dir = mkdtempSync(join(tmpdir(), 'outreach-wa-'));
const bridge = new DatabaseSync(join(dir, 'messages.db'));
bridge.exec(`CREATE TABLE chats (jid TEXT PRIMARY KEY, name TEXT, last_message_time TIMESTAMP);
  CREATE TABLE messages (id TEXT, chat_jid TEXT, sender TEXT, content TEXT, timestamp TIMESTAMP, is_from_me BOOLEAN,
    media_type TEXT, filename TEXT, url TEXT, media_key BLOB, file_sha256 BLOB, file_enc_sha256 BLOB, file_length INTEGER,
    PRIMARY KEY (id, chat_jid));`);
const device = new DatabaseSync(join(dir, 'whatsapp.db'));
device.exec('CREATE TABLE whatsmeow_lid_map (lid TEXT PRIMARY KEY, pn TEXT UNIQUE)');
device.prepare('INSERT INTO whatsmeow_lid_map VALUES (?, ?)').run('777', '420111');
const add = (id, jid, ts, fromMe = 0, content = 'x') => bridge.prepare(
  'INSERT OR REPLACE INTO messages (id, chat_jid, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?)').run(id, jid, content, ts, fromMe);

// Fake bridge: each /api/history call stores `perPage` older messages for the chat.
let perPage = 50, calls = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const { chat_jid } = JSON.parse(body);
  calls.push(chat_jid);
  if (perPage === 'timeout') return res.end(JSON.stringify({ received: 0, timeout: true }));
  for (let i = 0; i < perPage; i++) add(`old${calls.length}-${i}`, chat_jid, `${2020 - calls.length}-01-01 00:00:${String(i).padStart(2, "0")}+00:00`);
  res.end(JSON.stringify({ received: perPage }));
});
await new Promise((r) => server.listen(0, r));

process.env.WHATSAPP_DB = join(dir, 'messages.db');
process.env.OUTREACH_DATA_DIR = join(dir, 'app');
process.env.WHATSAPP_BRIDGE_URL = `http://localhost:${server.address().port}`;
const wa = await import('../lib/whatsapp.js');
const cache = await import('../lib/cache.js');
test.after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const ana = { id: 'a', phones: ['+420 111'] }, bo = { id: 'b', phones: ['+1 222'] };

test('one session reads everyone\'s chats (phone and lid), oldest first', () => {
  add('m1', '420111@s.whatsapp.net', '2026-01-01 10:00:00+00:00', 1, 'hello');
  add('m2', '777@lid', '2026-01-02 10:00:00+00:00', 0, 'hi back');
  add('m3', '1222@s.whatsapp.net', '2026-01-03 10:00:00+00:00');
  add('m4', '555@s.whatsapp.net', '2026-01-04 10:00:00+00:00'); // nobody's
  const s = wa.whatsappSession([ana, bo]);
  assert.deepEqual(s.history(ana).map((m) => [m.id, m.at, m.fromMe, m.text]), [
    ['420111@s.whatsapp.net:m1', '2026-01-01T10:00:00.000Z', true, 'hello'],
    ['777@lid:m2', '2026-01-02T10:00:00.000Z', false, 'hi back'],
  ]);
  assert.equal(s.history(bo).length, 1);
  assert.equal(wa.whatsappSession([ana], 1).history(ana).length, 1); // newest `limit`
});

test('the watcher reports chats with new rows, mapped to people', async () => {
  const seen = [];
  const stop = wa.whatsappWatch((jids) => seen.push(jids), 20);
  await sleep(50);
  assert.deepEqual(seen, []); // existing rows are not news
  add('m5', '777@lid', '2026-01-05 10:00:00+00:00');
  await sleep(80);
  stop();
  assert.deepEqual(seen, [['777@lid']]);
  assert.deepEqual(wa.whatsappOwners(seen[0], [ana, bo]), ['a']);
  assert.deepEqual(wa.whatsappOwners(['555@s.whatsapp.net'], [ana, bo]), []);
});

test('backfill pages back, stops on a short page, and skips chats asked lately', async () => {
  calls = [];
  perPage = 50;
  const run = () => wa.whatsappBackfill([bo], () => {}, { maxPages: 3 });
  // Full pages until maxPages, then a short page marks the chat complete.
  assert.deepEqual([...await run()], ['1222@s.whatsapp.net']);
  assert.equal(calls.length, 3);
  assert.equal(cache.waComplete('1222@s.whatsapp.net'), false);
  assert.ok(cache.waAskedAt('1222@s.whatsapp.net'));
  assert.equal((await run()).size, 0); // asked just now: skipped
  assert.equal(calls.length, 3);
  cache.markWaAsked('1222@s.whatsapp.net', '2000-01-01T00:00:00Z');
  perPage = 2;
  assert.equal((await run()).size, 1);
  assert.equal(cache.waComplete('1222@s.whatsapp.net'), true);
  const pages = calls.length;
  cache.markWaAsked('1222@s.whatsapp.net', '2000-01-01T00:00:00Z');
  await run();
  assert.equal(calls.length, pages); // complete: never asked again
});

test('a chat that times out is asked once and then left alone for hours', async () => {
  calls = [];
  perPage = 'timeout';
  const people = [ana];
  assert.equal((await wa.whatsappBackfill(people, () => {}, { maxPages: 5 })).size, 0);
  assert.equal(calls.length, 2); // one request per chat (phone jid + lid), no paging after a timeout
  await wa.whatsappBackfill(people, () => {}, { maxPages: 5 });
  assert.equal(calls.length, 2);
});
