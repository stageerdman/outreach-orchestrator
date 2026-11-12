# Chat — wiki

- Fronta (ResultsON Cockpit queue) is ordered in the browser, not the DB;
  the rules are copied in `fronta-rules.md` (from ResultsON, 2026-11-12).
- Refresh is staged (`lib/sync.js`): sources run fastest first (WhatsApp,
  then email) and each is published the moment it's collected, merged onto
  the *current* snapshot (`carryOver` + `mergeChannel`), so a live update that
  lands mid-refresh isn't overwritten. `running` ends with the last channel;
  the WhatsApp backfill runs after, in `state.backfill`, never as "refreshing".
- The backfill made refresh take minutes: it counted any new row as "gained"
  (live messages too), so chats never completed. Now only rows older than the
  chat's oldest count, a page under half full marks the chat complete, a
  timeout waits `WHATSAPP_BACKFILL_HOURS` (12 h; `wa_asked` in cache.db), and
  a run pages at most 5 times per chat.
- Bridge DB watching: the bridge writes with `INSERT OR REPLACE`, so every new
  or edited message gets a new rowid; `MAX(rowid)` once a second is enough.
  The DB is in rollback-journal mode (no WAL); a read-only handle with a
  100 ms busy timeout, dropped and reopened on any error, copes with the
  bridge writing, restarting or not running.
- One query reads every CRM person's WhatsApp chats
  (`chat_jid IN (SELECT value FROM json_each(?))`): `messages` has no index on
  `chat_jid`, so 557 per-person queries would each scan the table.
- IMAP: one kept ImapFlow connection that rests on INBOX (select + release a
  lock → ImapFlow idles there; `exists` = new mail). Anything that selects
  Sent/Archive goes back to INBOX afterwards, or IDLE would watch the wrong
  folder. Checks run one after another through a promise chain.
- The composer once sent the user's own typed messages (`own: true`
  requests); the user dropped that (2026-11-12): the box only talks to the
  AI, so Enter can safely run ✨ and drafts change only through the AI.
- The Cockpit source is the reference where `fronta-rules.md` is vague
  (`/Users/stage/dev/MAN 20/ResultsON`, `19-Cockpit.js` + `aktivniRezervace`
  in `16-ReklamyPrehled.js`). Followed it on: the meeting is the *latest*
  booking (unparseable time = no meeting, not an older one); zoneless ISO
  `meeting_at` ("2026-08-19T08:00", in real data) is Prague time; "meeting
  today" (950) = the live meeting is on today's Prague date.
- 3.4 filters a colleague's lead out when it falls in a "my zone" (triage /
  follow-ups) and isn't mine, so LEADY KOLEGŮ only holds their rows from the
  shared zones (new leads, no-shows, not reached…).
- Group-name tie-break (3.5) only matters for KAMPAŇ · name rows, which the
  main view drops; every main group has its own score.
- Speed: each PostgREST call costs ~0.3 s round trip + 0.3–0.6 s server/transfer
  from here; `count=exact` and projecting `meta` fields didn't help. What
  helped: no re-login (0.6–0.8 s) and fetching every page at once.
- The mail host advertises IPv6 that never answers: Node tried it first and
  every IMAP connect took ~20 s. `lib/email.js` resolves IPv4 itself and
  passes `servername` for TLS. Each IMAP command still costs ~1 s there, so
  round trips are the budget: a folder is opened only when its STATUS
  UIDNEXT moved (`imapNext:<folder>` in kv), and a refresh skips the header
  check if one ran in the last minute.
- The persisted snapshot with every CRM contact (545) is ~0.7 MB.
- Resolved from issues.txt (2026-11-12): "fully fetched WhatsApp chats are
  kept in memory, so a restart re-asks the phone" (they're in cache.db, plus
  `wa_asked` now spaces out re-asks); "already messaged today sees messages
  sent outside the app only after the next refresh" (the WhatsApp watcher
  sees them within ~1 s, IMAP IDLE sees new INBOX mail at once and Sent
  within 2 min).
- UI (Phase 3): the chat column is one DOM node moved between the Messages
  and Tasks views; each list keeps its own selection. The composer is built
  once per open chat and only updated (`updateComposer`), and the draft box
  never re-renders under a focused field (deferred to focusout), so SSE
  updates can't eat what the user types.
- A refresh's last `snapshot` event comes before `running` turns false, so
  the UI still polls `/api/refresh` once a second while a refresh runs; the
  spinner stops when stage reaches `email` (CRM + WhatsApp are in).
- Sent messages not yet in the history are shown from the requests (status
  sent, newer than my last message), so no client-side pending state is
  needed; WhatsApp ones say "opened in WhatsApp".
- Unread = client messages after max(read in app, my last message): on a
  first run every chat where the client wrote last counts (45 of 257 here).
- `x?.a.b` throws when `x` is `false` (optional chaining only skips
  null/undefined): write `cond ? find() : null`, not `cond && find()`.
- Headless Chrome over CDP (`--remote-debugging-port`, Node's global
  WebSocket) is a workable stand-in for browser checks when Claude in Chrome
  isn't connected; navigate via about:blank, a same-URL hash change doesn't reload.
- The list width lives in one root variable (`--feed-w`) that CSS clamps
  (`clamp(--feed-min, --feed-w, min(--feed-max, 100vw - rail - --chat-min))`),
  so the stored preference survives a smaller window; the separator sits
  absolutely on the list's right edge, which keeps the chat column (moved
  between views) out of the grid change.
