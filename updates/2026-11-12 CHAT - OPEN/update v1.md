# Chat — update v1 (OPEN)

## Goal
Tasks follow ResultsON's Fronta (same rows, groups and order as the Cockpit's
"Volat teď"). Refresh is fast and runs on start. Clicking a task opens a chat
column (newest at the bottom, a composer with ✨ for an AI draft shown as a
gray message, adjusted by typing a note and pressing ✨ again). A new
Messages section (above Tasks) lists every CRM contact with WhatsApp/email,
WhatsApp-style: name, stage, one-line preview, time, unread count; new
WhatsApp messages show up within seconds.

## Starting state (measured 2026-11-12)
- 81 feed people. Refresh: CRM 3.1 s (login + 5 sequential/parallel calls),
  IMAP connect + header scan 5.4 s, email bodies 2.5 s, WhatsApp 0.1 s.
- Then the WhatsApp backfill re-asks the phone about 14 chats every refresh
  (2–20 s per request, up to 20 pages per chat) and republishes everything:
  this is what made refresh take minutes.
- No auto refresh on start; no live updates; timeline expands inside the row.
- CRM size: 557 contacts, 145 open tasks, 1300 calls, 1850 funnel events,
  1139 notes — small enough to read whole tables in parallel.

## Decisions (user, 2026-11-12)
- Tasks = exactly what Fronta shows (rules 3.1–3.5 of `fronta-rules.md`,
  including teammates' rows in shared zones and LEADY KOLEGŮ at the bottom).
  Main view only (no kampaň); read-only: never lock, merge-close or self-heal.
- Messages = every CRM contact (not only the feed) with WhatsApp or email.
- WhatsApp Send keeps opening WhatsApp prefilled (counts as sent).

## Shared contracts
- `listPeople()` → every CRM contact as a person
  `{ id, name, company, emails, phones, stage, task|null, queue|null }`;
  `queue` = `{ group, score, color: 'A'|'B'|'C', order, meetingAt|null,
  due: bool, qualify: bool }` for rows in Fronta's main list, else null.
  Non-ResultsON CRMs: `queue` undefined = in the feed.
- `GET /api/people` → feed only (queue set), in Fronta order, no messages;
  keeps `lastSentAt` / `lastClientAt`.
- `GET /api/people/:id/history` → any snapshot person (feed or Messages).
- `GET /api/chats` → `[{ id, name, stage, channels, last: { channel, at,
  fromMe, text }, unread }]`, newest first; CRM contacts with ≥1 message.
- `POST /api/chats/:id/read` → marks read (unread = client messages after
  max(last read in app, my last message)).
- `GET /api/events` (SSE) → `snapshot` (refresh published), `messages`
  `{ ids }` (new messages for these people), `requests` (draft changed).
- `POST /api/people/:id/send { channel, text, subject? }` → the user's own
  message from the composer (email over SMTP, WhatsApp opens prefilled);
  recorded like a sent draft.

## Phases
### 1. Fronta order — next
- [ ] `lib/fronta.js`: pure derive/hide/merge/classify/callNow/sort (Prague
      time), mirroring section 4 of `fronta-rules.md`.
- [ ] `lib/resultson.js`: whole tables in parallel (paginated), token reused
      while valid, every contact a person with stage + queue.
- Ends with: tests for every group, hide rule, merge and sort key.
### 2. Fast refresh + live — next
- [ ] Refresh on server start; CRM + WhatsApp publish first, email merges in.
- [ ] One long-lived IMAP connection (IDLE on INBOX) instead of a new one
      per refresh; new mail merges in.
- [ ] WhatsApp watcher on the bridge DB (read-only, ~1 s) → SSE.
- [ ] Backfill in the background, never blocking; chats that time out or
      return nothing aren't re-asked every refresh.
- [ ] `/api/chats`, read state (app data folder), `/api/events`, `send`.
- Ends with: tests; refresh timed before/after on real data.
### 3. UI — after 1–2
- [ ] UX specs from parallel UX agents (feed, chat column, Messages list).
- [ ] Tasks: Fronta groups; click → chat column. Composer + ✨ draft flow.
- [ ] Messages section above Tasks, live unread counts.
- Ends with: verified in the browser on real data (no sends).
