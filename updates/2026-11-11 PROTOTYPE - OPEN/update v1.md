# Prototype — update v1 (OPEN)

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
- [ ] Fill `.env` (CRM URL/token + field mapping, IMAP host/user/app
      password), link the WhatsApp bridge.
- [ ] Run a full refresh on real data: time it, check matching (people with
      no history = missing country code? wrong field mapping?).
- [ ] Tune `EMAIL_LIMIT` / `WHATSAPP_LIMIT`; decide whether WhatsApp group
      chats or local-format phones need handling now.
- Ends with: prototype used for a real outreach session; close update.

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
- Next: phase 4. Blocked on CRM URL/token and IMAP credentials in `.env`,
  and linking the WhatsApp bridge.
