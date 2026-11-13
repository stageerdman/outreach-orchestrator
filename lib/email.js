// Email history over IMAP: everything to or from a person's addresses,
// searched across the Inbox, Sent and Archive folders, over one kept connection.
import { ImapFlow } from 'imapflow';
import { lookup } from 'node:dns/promises';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import * as cache from './cache.js';

const env = process.env;
export const emailConfigured = () => Boolean(env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASS);

// Connects over IPv4 when the host has an IPv4 address (TLS still checks the
// name): this mail host advertises IPv6 that doesn't answer, which cost ~20 s
// per connect before falling back.
async function client() {
  const ip = await lookup(env.IMAP_HOST, { family: 4 }).then((a) => a.address, () => env.IMAP_HOST);
  return new ImapFlow({
    host: ip, servername: env.IMAP_HOST,
    port: Number(env.IMAP_PORT || 993),
    secure: env.IMAP_SECURE !== 'false',
    auth: { user: env.IMAP_USER, pass: env.IMAP_PASS },
    logger: false,
    maxIdleTime: 5 * 60_000, // re-issue IDLE before servers drop it
  });
}

const sentFolder = (boxes) => boxes.find((b) => b.specialUse === '\\Sent')?.path || env.IMAP_SENT_FOLDER;

async function findFolders(imap) {
  const boxes = await imap.list();
  const sent = sentFolder(boxes);
  const archive = boxes.find((b) => b.specialUse === '\\Archive')?.path;
  return { all: [...new Set(['INBOX', sent, archive].filter(Boolean))], sent };
}

// One long-lived IMAP connection, opened on first use and kept. It rests on
// INBOX, where IDLE reports new mail within seconds ("exists"); emailWatch()
// also checks every folder every 2 min and reconnects with backoff.
let imap = null, connecting = null, folders = { all: [], sent: null }, watcher = null, retry = 0, timer = null;

function connection() {
  if (imap?.usable) return Promise.resolve(imap);
  return (connecting ??= (async () => {
    const c = await client();
    c.on('error', (e) => console.error('IMAP:', e.message));
    c.on('close', () => { if (imap === c) imap = null; reconnectLater(); });
    c.on('exists', (d) => { if (d.path === 'INBOX' && d.count > d.prevCount) checkSoon(['INBOX']); });
    await c.connect();
    folders = await findFolders(c);
    imap = c;
    retry = 0;
    await restOnInbox(c);
    return c;
  })().finally(() => { connecting = null; }));
}

// Selecting INBOX and letting go: with nothing else queued, ImapFlow idles there.
async function restOnInbox(c) {
  (await c.getMailboxLock('INBOX')).release();
}

function reconnectLater() {
  if (!watcher || timer) return;
  timer = setTimeout(() => { timer = null; checkSoon(); }, Math.min(5_000 * 2 ** retry++, 300_000));
}

// Reads headers newer than the cached ones in these folders; returns the new
// ones. Round trips are what's slow (~0.5–2 s each), so a folder is first
// asked for its STATUS and only opened when its UIDNEXT moved since last time.
async function syncHeaders(c, list = folders.all) {
  const fresh = [];
  let left = false;
  try {
    for (const folder of list) {
      const st = await c.status(folder, { uidNext: true, uidValidity: true });
      const validity = String(st.uidValidity), seen = cache.getJSON(`imapNext:${folder}`);
      if (seen?.validity === validity && seen.uidNext === st.uidNext) continue;
      const lock = await c.getMailboxLock(folder);
      left ||= folder !== 'INBOX';
      try {
        const lastUid = cache.emailFolder(folder, String(c.mailbox.uidValidity));
        const got = [];
        if (c.mailbox.exists) {
          // "N:*" always includes the newest message, even below N; filter it.
          for await (const msg of c.fetch(`${lastUid + 1}:*`, { envelope: true, uid: true }, { uid: true })) {
            if (msg.uid <= lastUid) continue;
            const e = msg.envelope || {};
            const addresses = [...(e.from || []), ...(e.to || []), ...(e.cc || [])]
              .map((a) => a.address?.toLowerCase()).filter(Boolean);
            got.push({ uid: msg.uid, addresses });
          }
        }
        cache.addEmailHeaders(folder, got);
        cache.setJSON(`imapNext:${folder}`, { validity: String(c.mailbox.uidValidity), uidNext: c.mailbox.uidNext });
        fresh.push(...got.map((h) => ({ folder, ...h })));
      } finally {
        lock.release();
      }
    }
  } finally {
    if (left && c.usable) await restOnInbox(c);
  }
  return fresh;
}

// Checks run one after another; new headers go to the watcher as the set of
// addresses involved. A failure (connection lost) schedules a reconnect.
let checking = Promise.resolve(), checkedAt = 0;
function checkSoon(list) {
  checking = checking.then(async () => {
    const c = await connection();
    const started = Date.now(), fresh = await syncHeaders(c, list ?? folders.all);
    if (!list) checkedAt = started;
    if (fresh.length && watcher) watcher([...new Set(fresh.flatMap((h) => h.addresses))]);
  }).catch((e) => { console.error('IMAP check:', e.message); reconnectLater(); });
  return checking;
}

// Live mail: onAddresses(addresses) whenever new emails arrive in any folder.
// Returns a stop function.
export function emailWatch(onAddresses, every = 120_000) {
  if (!emailConfigured()) return () => {};
  watcher = onAddresses;
  checkSoon();
  const t = setInterval(() => checkSoon(), every);
  t.unref?.();
  return () => { clearInterval(t); watcher = null; };
}

// A refresh's view of the mailbox, on the shared connection: headers are
// brought up to date unless a full check ran in the last minute (the watcher
// keeps them current), then history(person) matches addresses locally and
// downloads only emails not cached yet.
export async function emailSession(people, limit = Number(env.EMAIL_LIMIT || 50)) {
  if (!emailConfigured()) return { history: async () => [], close: async () => {} };
  const c = await connection();
  if (Date.now() - checkedAt > 60_000) await checkSoon();
  const index = folders.all.flatMap((f) => cache.emailHeaders(f));
  return {
    history: (person) => download(c, matching(index, person.emails || [], limit), person.emails || []),
    close: async () => {},
  };
}

// { folder: [uid, ...] } of the newest `limit` emails per folder from/to/cc the addresses.
export function matching(index, addresses, limit) {
  const out = {};
  if (addresses.length === 0) return out;
  for (const m of index) {
    if (m.addresses.some((a) => addresses.includes(a))) (out[m.folder] ??= []).push(m.uid);
  }
  for (const f in out) out[f] = out[f].sort((x, y) => x - y).slice(-limit);
  return out;
}

async function download(imap, uidsByFolder, addresses) {
  const out = [];
  for (const [folder, uids] of Object.entries(uidsByFolder)) {
    const missing = uids.filter((uid) => !cache.cachedEmail(folder, uid));
    if (missing.length) {
      const lock = await imap.getMailboxLock(folder);
      try {
        for await (const msg of imap.fetch(missing.join(','), { source: true, envelope: true }, { uid: true })) {
          const parsed = await simpleParser(msg.source);
          cache.cacheEmail(folder, msg.uid, {
            id: `${folder}:${msg.uid}`,
            messageId: parsed.messageId || '',
            at: (parsed.date || msg.envelope.date || new Date(0)).toISOString(),
            fromAddress: parsed.from?.value?.[0]?.address?.toLowerCase() || '',
            from: parsed.from?.text || '',
            to: parsed.to?.text || '',
            subject: parsed.subject || '(no subject)',
            text: (parsed.text || '').trim(),
          });
        }
      } finally {
        lock.release();
      }
      if (folder !== 'INBOX') await restOnInbox(imap);
    }
    for (const uid of uids) {
      const m = cache.cachedEmail(folder, uid);
      if (!m) continue;
      const { fromAddress, ...rest } = m;
      out.push({ channel: 'email', ...rest, fromMe: !addresses.includes(fromAddress) });
    }
  }
  return dedupe(out);
}

// The same email can sit in both Inbox and Sent; keep one copy.
// Message-ID identifies it; date + subject is the fallback when it's missing.
export function dedupe(messages) {
  const seen = new Set();
  return messages.filter((m) => {
    const key = m.messageId || `${m.at}|${m.subject}`;
    return seen.has(key) ? false : seen.add(key);
  });
}

// Sending over SMTP: same account as IMAP unless SMTP_* says otherwise
// (host defaults to IMAP_HOST with "imap." -> "smtp."). The sent email is also
// put in the Sent folder, since many servers don't do that for SMTP.
export const smtpConfigured = () => Boolean(env.SMTP_HOST || emailConfigured());

// Resolves to { messageId }, so the app's own copy can be matched with the Sent folder's.
export async function sendEmail({ to, subject, text, inReplyTo }) {
  if (!smtpConfigured()) throw new Error('Email sending is not set up (IMAP/SMTP settings in .env)');
  const port = Number(env.SMTP_PORT || 465);
  const auth = { user: env.SMTP_USER || env.IMAP_USER, pass: env.SMTP_PASS || env.IMAP_PASS };
  const from = env.EMAIL_FROM || (env.EMAIL_FROM_NAME ? `"${env.EMAIL_FROM_NAME}" <${auth.user}>` : auth.user);
  const mail = { from, to, subject, text, ...(inReplyTo && { inReplyTo, references: [inReplyTo] }) };
  const compiled = new MailComposer(mail).compile();
  const raw = await compiled.build(), messageId = compiled.messageId();
  await nodemailer.createTransport({
    host: env.SMTP_HOST || env.IMAP_HOST.replace(/^imap\./, 'smtp.'), port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE !== 'false' : port === 465, auth,
  }).sendMail({ envelope: { from: auth.user, to }, raw });
  if (!emailConfigured()) return { messageId };
  try {
    const c = await connection();
    if (folders.sent) {
      await c.append(folders.sent, raw, ['\\Seen']);
      checkSoon([folders.sent]); // shows up in the history within seconds
    }
  } catch (e) {
    console.error('Sent, but not saved to the Sent folder:', e.message);
  }
  return { messageId };
}
