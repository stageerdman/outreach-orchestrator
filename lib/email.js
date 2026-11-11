// Email history over IMAP: everything to or from a person's addresses,
// searched across the Inbox, Sent and Archive folders.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import * as cache from './cache.js';

const env = process.env;
export const emailConfigured = () => Boolean(env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASS);

function client() {
  return new ImapFlow({
    host: env.IMAP_HOST,
    port: Number(env.IMAP_PORT || 993),
    secure: env.IMAP_SECURE !== 'false',
    auth: { user: env.IMAP_USER, pass: env.IMAP_PASS },
    logger: false,
  });
}

const sentFolder = (boxes) => boxes.find((b) => b.specialUse === '\\Sent')?.path || env.IMAP_SENT_FOLDER;

async function findFolders(imap) {
  const boxes = await imap.list();
  const sent = sentFolder(boxes);
  const archive = boxes.find((b) => b.specialUse === '\\Archive')?.path;
  return [...new Set(['INBOX', sent, archive].filter(Boolean))];
}

// One IMAP connection per refresh. Each folder's headers are cached locally;
// a refresh reads only headers newer than the last cached UID. history(person)
// matches addresses locally and downloads only emails not cached yet.
export async function emailSession(limit = Number(env.EMAIL_LIMIT || 50)) {
  if (!emailConfigured()) return { history: async () => [], close: async () => {} };
  const imap = client();
  await imap.connect();
  const index = [];
  for (const folder of await findFolders(imap)) {
    const lock = await imap.getMailboxLock(folder);
    try {
      const lastUid = cache.emailFolder(folder, String(imap.mailbox.uidValidity));
      if (imap.mailbox.exists) {
        const fresh = [];
        // "N:*" always includes the newest message, even below N; filter it.
        for await (const msg of imap.fetch(`${lastUid + 1}:*`, { envelope: true, uid: true }, { uid: true })) {
          if (msg.uid <= lastUid) continue;
          const e = msg.envelope || {};
          const addresses = [...(e.from || []), ...(e.to || []), ...(e.cc || [])]
            .map((a) => a.address?.toLowerCase()).filter(Boolean);
          fresh.push({ uid: msg.uid, addresses });
        }
        cache.addEmailHeaders(folder, fresh);
      }
      index.push(...cache.emailHeaders(folder));
    } finally {
      lock.release();
    }
  }
  return {
    history: (person) => download(imap, matching(index, person.emails, limit), person.emails),
    close: () => imap.logout().catch(() => {}),
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

export async function sendEmail({ to, subject, text, inReplyTo }) {
  if (!smtpConfigured()) throw new Error('Email sending is not set up (IMAP/SMTP settings in .env)');
  const port = Number(env.SMTP_PORT || 465);
  const auth = { user: env.SMTP_USER || env.IMAP_USER, pass: env.SMTP_PASS || env.IMAP_PASS };
  const from = env.EMAIL_FROM || (env.EMAIL_FROM_NAME ? `"${env.EMAIL_FROM_NAME}" <${auth.user}>` : auth.user);
  const mail = { from, to, subject, text, ...(inReplyTo && { inReplyTo, references: [inReplyTo] }) };
  const raw = await new MailComposer(mail).compile().build();
  await nodemailer.createTransport({
    host: env.SMTP_HOST || env.IMAP_HOST.replace(/^imap\./, 'smtp.'), port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE !== 'false' : port === 465, auth,
  }).sendMail({ envelope: { from: auth.user, to }, raw });
  if (!emailConfigured()) return;
  const imap = client();
  try {
    await imap.connect();
    const sent = sentFolder(await imap.list());
    if (sent) await imap.append(sent, raw, ['\\Seen']);
  } catch (e) {
    console.error('Sent, but not saved to the Sent folder:', e.message);
  } finally {
    await imap.logout().catch(() => {});
  }
}
