# Prototype — update v1 (CLOSED)

## Goal
One click on **Refresh** does everything: pull the people to reach out to from
the CRM, pull each person's email (IMAP) and WhatsApp history, and show the
people list. Clicking a person **expands their row in place** with their full
communication history, email and WhatsApp merged in one timeline.

## Starting state
- Sources work per person, on demand: `GET /api/people`, then
  `GET /api/people/:id/history` opens a fresh IMAP connection per click.
- UI is a list on the left and a detail panel on the right. No refresh button,
  no overview of who has history.
- No tests, no `.env` (runs on sample people only). See `issues.txt`.

## Phases

### 1. Solid sources (tests first) — done
- [x] `node --test` setup in `test/`, `npm test` wired, `package.json`
      cleanup (`main`, `description`, `engines: node >=22.5`).
- [x] Tests: CRM normalization (`get`, dot paths, string-or-list
      emails/phones), phone → WhatsApp JID, email dedup.
- [x] Email dedup by Message-ID (fallback `date|subject`).
- Ends with: `npm test` green.

### 2. Refresh = full sync (server) — done
- [x] `POST /api/refresh`: fetch people fresh from the CRM, then history for
      everyone. Email over **one** IMAP connection for the whole run (not one
      per person); WhatsApp from one read-only DB handle.
- [x] Result kept as an **in-memory snapshot** `{ at, people, errors }`, each
      person carrying `messages`, `lastAt` and per-channel counts. Nothing
      private is written to disk.
- [x] One refresh at a time; `GET /api/refresh` returns progress
      (`running`, `done / total`) for the UI to poll.
- [x] `GET /api/people` and `/history` served from the snapshot (instant).
- [x] Per-source and per-person errors kept, not fatal: one broken mailbox
      doesn't stop the sync.
- Ends with: tests for the merge/snapshot shape; run against sample data
  and hit the endpoints.

### 3. UI: people list with expandable history — done
- [x] Refresh button, "last refreshed …" and progress while running. First
      page load starts a refresh if there is no snapshot yet.
- [x] People list: name, company, last contact, email/WhatsApp counts.
      Sorted by last contact (most recent first); search stays.
- [x] Click (or Enter/Space) on a person expands their row with the merged
      timeline; click again collapses. `aria-expanded`, focus states,
      keyboard through the list.
- [x] One render function per message type, reused; email/WhatsApp filter
      inside the expanded row; long emails clamped with "Show more".
- [x] Source errors shown honestly (status bar + inside the person's row).
- UX experts in parallel: people list, expanded timeline, refresh/status.
- Ends with: open the UI and click through it.

### 4. Real data check
- [x] `.env` filled: ResultsON CRM (login per refresh, "my open tasks"
      query), IMAP `imap.miowebmail.cz`.
- [x] WhatsApp bridge fixed ("Client outdated (405)": whatsmeow bumped,
      5 context args added, rebuilt in vendor, user-approved exception).
- [x] WhatsApp linked (4,885 messages, 460 chats synced). Matching fixed
      for hidden-id (`@lid`) chats via the bridge's lid → phone map.
- [x] Final real refresh: 65 people, 17s, no errors. WhatsApp: 59 people,
      202 msgs. Email: 19 people, 27 msgs. Both: 15. Neither: 2.
- [x] Full refresh on real data: 65 people, 19 with email (27 emails), no
      errors. 117s → 15s after switching to one header scan per folder.
- [x] Phone format: 100 of 144 CRM phones are local format; fixed by using
      `phone_e164` (filled for 143 of 144).
- [x] Limits: defaults fine (no person near 50 emails / 500 WhatsApp).
      Local-format phones solved by `phone_e164`; group chats left out
      (see issues.txt).
- Ends with: prototype used for a real outreach session; close update.

### Follow-up (2026-11-11): older WhatsApp history
- [x] Reported: a contact with many messages showed only one. Cause: at link
      time the phone sends only the latest message per chat, then trickles
      more history in the background.
- [x] User chose history for CRM people only (not a full re-link): bridge
      `POST /api/history` (on-demand sync, one chat, 50 msgs, waits for the
      phone's answer) + `whatsappBackfill` after each refresh.
- [x] Real run: 435 → 692 WhatsApp messages for 60 people; people with a
      single message 32 → 5. List visible at ~15s, older history done in
      ~3–4 min in the background; next refresh 12s (finished chats skipped).

## Decisions
- Expand-in-place replaces the right-hand detail panel (asked for
  explicitly; supersedes the CLAUDE.md "list on one side, timeline on the
  other" layout for this app).
- Snapshot lives in memory only: restart = refresh again. Fine for a local
  prototype and keeps private messages off disk.
- Progress by polling, not SSE/websockets: simplest thing that works.
- Each source exposes `<channel>Session()` → `{ history(person), close() }`;
  `lib/sync.js` holds the source list and the snapshot. A new channel = a new
  lib file + one line in `SOURCES`.
- People are fetched in one call per refresh; email searches one person at a
  time over a single IMAP connection (IMAP can't search in parallel on one
  connection anyway).
- UI synthesis of three UX reviews (list, timeline, header): one row open at
  a time with a sticky header, last 20 messages + "Show earlier", filter only
  when both channels exist, source state in words not just dot colour, list
  stays usable during a refresh.

## Out of scope (prototype)
Sending messages, auto/background refresh, persistent cache, group chats,
other channels.

## Status
- 2026-11-11: phases 1–3 done. 12 tests green (`npm test`). Verified by
  running the server and driving the UI in headless Chrome against sample
  people plus a throwaway fake WhatsApp DB: refresh progress, list,
  expand/collapse, show earlier/more, filter, keyboard, search, empty
  states, open row survives a refresh, no horizontal scroll at phone width,
  no JS errors.
- 2026-11-11: all four phases done; update closed.
