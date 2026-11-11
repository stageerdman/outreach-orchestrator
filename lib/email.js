// Email history over IMAP: everything to or from a person's addresses,
// searched across the Inbox and the Sent folder.
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
  return [...new Set(['INBOX', sent].filter(Boolean))];
}

// One IMAP connection for a whole refresh; history(person) searches it per person.
export async function emailSession(limit = Number(env.EMAIL_LIMIT || 50)) {
  if (!emailConfigured()) return { history: async () => [], close: async () => {} };
  const imap = client();
  await imap.connect();
  const folders = await findFolders(imap);
  return {
    history: (person) => search(imap, folders, person.emails, limit),
    close: () => imap.logout().catch(() => {}),
  };
}

async function search(imap, folders, addresses, limit) {
  if (addresses.length === 0) return [];
  const out = [];
  for (const folder of folders) {
    const lock = await imap.getMailboxLock(folder);
    try {
      const or = addresses.flatMap((a) => [{ from: a }, { to: a }, { cc: a }]);
      const uids = (await imap.search(or.length > 1 ? { or } : or[0], { uid: true })) || [];
      const recent = uids.slice(-limit);
      if (recent.length === 0) continue;
      for await (const msg of imap.fetch(recent, { source: true, envelope: true }, { uid: true })) {
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
