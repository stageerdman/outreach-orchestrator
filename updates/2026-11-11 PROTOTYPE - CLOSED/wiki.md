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
- ResultsON (Supabase PostgREST): `v_queue` is a view and can't embed
  `contacts`, so it can't return `phone_e164`. Querying `contacts` with
  `tasks!inner(id)&tasks.assigned_to=eq.<me>&tasks.status=eq.open` returns
  exactly the same people as `v_queue?assigned_to=eq.<me>`, with every
  contact field. The user's team-member id comes from
  `team_members?auth_user_id=eq.<auth user id>`. Task statuses: open, done,
  cancelled.
- The publishable `apikey` alone returns nothing useful; RLS needs a logged-in
  team member's token. Tokens last 1h, so the app logs in per refresh.
- IMAP: one SEARCH per person per folder cost ~2s/person (195 round trips for
  65 people). Reading envelopes once per folder and matching locally is ~8x
  faster. Revisit if a mailbox gets huge (envelopes of every message are
  read each refresh).
- whatsmeow "Client outdated (405)": WhatsApp drops old client versions;
  updating whatsmeow is the fix. Newer whatsmeow takes a `context.Context`
  first arg on Download, sqlstore.New, GetFirstDevice, GetGroupInfo and
  Contacts.GetContact.
- WhatsApp `@lid` chats: most 1:1 chats (358 of 424 here) are stored as
  `<lid>@lid`, not `<phone>@s.whatsapp.net`. The bridge's whatsmeow store
  `whatsapp.db` has `whatsmeow_lid_map(lid, pn)` (digits only, no suffix);
  every lid chat had a mapping. Opened read-only, like messages.db.
- The bridge must keep running for new messages to sync; closing it keeps the
  history already stored.
