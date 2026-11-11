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

export async function emailHistory(addresses, limit = Number(env.EMAIL_LIMIT || 50)) {
  if (!emailConfigured() || addresses.length === 0) return [];
  const imap = client();
  await imap.connect();
  const out = [];
  try {
    for (const folder of await findFolders(imap)) {
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
  } finally {
    await imap.logout().catch(() => {});
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
