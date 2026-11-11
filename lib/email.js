// Email history over IMAP: everything to or from a person's addresses,
// searched across the Inbox, Sent and Archive folders.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

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

async function findFolders(imap) {
  const boxes = await imap.list();
  const sent = boxes.find((b) => b.specialUse === '\\Sent')?.path || env.IMAP_SENT_FOLDER;
  const archive = boxes.find((b) => b.specialUse === '\\Archive')?.path;
  return [...new Set(['INBOX', sent, archive].filter(Boolean))];
}

// One IMAP connection per refresh. Each folder's headers are read once up
// front; history(person) matches addresses locally and downloads only the
// matching emails (one search per person per folder was ~2s per person).
export async function emailSession(limit = Number(env.EMAIL_LIMIT || 50)) {
  if (!emailConfigured()) return { history: async () => [], close: async () => {} };
  const imap = client();
  await imap.connect();
  const index = [];
  for (const folder of await findFolders(imap)) {
    const lock = await imap.getMailboxLock(folder);
    try {
      if (!imap.mailbox.exists) continue;
      for await (const msg of imap.fetch('1:*', { envelope: true, uid: true })) {
        const e = msg.envelope || {};
        const addresses = [...(e.from || []), ...(e.to || []), ...(e.cc || [])]
          .map((a) => a.address?.toLowerCase()).filter(Boolean);
        index.push({ folder, uid: msg.uid, addresses });
      }
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
    const lock = await imap.getMailboxLock(folder);
    try {
      for await (const msg of imap.fetch(uids.join(','), { source: true, envelope: true }, { uid: true })) {
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.value?.[0]?.address?.toLowerCase() || '';
        out.push({
          channel: 'email',
          id: `${folder}:${msg.uid}`,
          messageId: parsed.messageId || '',
          at: (parsed.date || msg.envelope.date || new Date(0)).toISOString(),
          fromMe: !addresses.includes(from),
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
