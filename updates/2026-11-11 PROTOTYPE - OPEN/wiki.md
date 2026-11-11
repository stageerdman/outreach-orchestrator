# Prototype — wiki

- Refresh is the single entry point: CRM → history for everyone → snapshot.
  The UI only reads the snapshot, so clicking a person is instant.
- Email dedup keys on Message-ID (fallback `date|subject`): the old
  `date|subject` key merged different emails sent at the same second.
- Testing the UI without real data: point `WHATSAPP_DB` at a throwaway SQLite
  file with a `messages` table (id, chat_jid, sender, content, timestamp,
  is_from_me, media_type) holding fake messages for the sample phones. Keep it
  outside the repo.
- Headless Chrome over CDP (`--remote-debugging-port`, Node's built-in
  WebSocket) works for driving the UI when the Chrome extension isn't
  connected. Gotcha: `Runtime.evaluate` shares global scope across calls, so a
  second top-level `const x` fails silently; wrap snippets in `{ }`.
