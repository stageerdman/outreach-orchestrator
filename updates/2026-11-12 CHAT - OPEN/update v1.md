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
### 1. Fronta order — done
- [x] `lib/fronta.js`: pure facts/hide/merge/classify/callNow/sort (Prague
      time), mirroring `19-Cockpit.js` (local checkout of ResultsON's
      `update/nedokonceno-followup-tabs` branch) where the doc is vague.
- [x] `lib/resultson.js`: 9 tables read whole in parallel (limit/offset
      pages, as many at once as last time), token reused while valid; every
      contact a person with stage + queue. `myTasks` removed.
- [x] Tests: `test/fronta.test.js` (every group, check order, hide rules,
      merge + qualify, multi-booking, both meeting formats, sort key; also
      passes under other TZs) and the new `toPeople` shape.
- Measured 2026-11-12 on real data: 547 people, 88 in the call-now list:
  DOMLUVENÝ FOLLOW-UP 14, NO SHOW 2, FOLLOWUP PO KONZULTACI 19, VRÁCÍ SE 1,
  SPLÁTKY 1, NEDOVOLANÉ 26, LEADY KOLEGŮ 25 (no live meetings today, so no
  TRIÁŽ / POTVRZENÍ / NOVÝ LEAD rows). CRM 1.6 s cold (login ~0.7 s),
  0.8–0.9 s with the token reused (was 3.1 s).
### 2. Fast refresh + live — done (2026-11-12)
- [x] Refresh on server start; WhatsApp (local) publishes first, email merges
      in; `running` ends when data is complete, backfill is `state.backfill`.
- [x] One long-lived IMAP connection resting on INBOX (IDLE → `exists`),
      every folder checked every 2 min by STATUS, reconnect with backoff;
      new mail re-collects only the people involved.
- [x] WhatsApp watcher: `MAX(rowid)` on the bridge DB every second
      (read-only) → re-collect those people → SSE `messages`.
- [x] Backfill in the background; counts only older rows; short page =
      complete; timeouts wait 12 h; ≤5 pages per chat per run.
- [x] `/api/chats`, `/api/chats/:id/read` (`reads.json`), `/api/events`,
      `/api/people/:id/send` (request with `own: true` + `ai.approve`).
- [x] Tests: unread/chat list, staged merge, jid→person, watcher and
      backfill skip on temp SQLite + a fake bridge. 91/91 pass.
- Measured (real data, isolated copy of the app data):
  - Before: data after 8.7 s, "refreshing" until 58.9 s (backfill of 14
    chats + full republish); no refresh on start.
  - After, on start: CRM + WhatsApp published at 2.2 s, email at 4.5 s
    (`running` false); a second refresh 1.3 s. Bridge write → SSE event
    median 0.6 s, max 0.9 s.
  - First run with all 545 contacts downloads their email bodies once
    (~50 s at this server's latency), then cached. The first backfill asks
    about every CRM chat once (182), in the background.
- API shapes: `/api/people` = feed people (`queue !== null`), sorted by
  `queue.order`, `{ ...person, counts, lastAt, errors, lastSentAt,
  lastClientAt }`. `/api/chats` = `[{ id, name, stage, channels (with
  messages), last: { channel, at, fromMe, text ≤140 chars, one line },
  unread }]`. `POST /api/chats/:id/read` → `{ id, readAt }`. SSE events:
  `snapshot { at, stage }` (per published channel), `messages { ids }`,
  `requests { id, personId, status }`, `: ping` every 25 s.
### 3. UI — done (2026-11-12)
- [x] UX specs from three parallel UX agents (feed, chat column, Messages
      list) plus a synthesis that overrides them where they differ.
- [x] Server bits for the composer: a draft keeps `channel` (POST
      `/api/requests` and regenerate accept one; the AI is held to it),
      `instruction` and `previousId` (regenerate); PUT can switch a waiting
      draft's channel (email subject = "Re: last"); `/history` adds `reach`
      (where the composer can write) and `waKnown`. Tests: 4 new, 95/95.
- [x] Tasks: Fronta groups in server order, Czech names, A/B/C dots,
      LEADY KOLEGŮ closed; "replied 5m" / "+ qualify" / meeting time on rows;
      per-row AI arrow removed (status text instead), "Draft N" kept.
- [x] One chat column for Tasks and Messages: header (name, stage, copyable
      contact, task line + note), thread from the bottom with day separators,
      channel tag only where it changes, quoted email history behind "Show
      quoted", "↓ N new" when reading up; composer with the two modes, ✨
      notes shown in the chat, earlier versions folded, draft editable in place.
- [x] Messages section (first, default): WhatsApp-style rows, unread pills,
      rail + title badge, read after 1 s on screen, order frozen under the
      pointer/focus, polite announcements of new messages from others.
- [x] One SSE stream replaces the 1 s refresh poll and the 2 s request poll.
- Verified on real data (isolated app data copy, port 3102, headless Chrome
  over CDP since Claude in Chrome wasn't connected): Fronta groups in order,
  row click opens the chat scrolled to the bottom, ↑/↓ selection + debounced
  chat, Enter → composer, Esc back, ← to the group header, 820 px pane swap,
  dark mode, Messages badge 45 → 44 after opening an unread chat. ✨ end to
  end: first draft 9.6 s, regenerate with "make it shorter" 5.1 s, note line +
  "Earlier draft" shown, updates arrived over SSE. No send was pressed.
- Decided: no × close in the chat (Esc / select another), no channel filters,
  no dock badge / notifications / sound, no pointer-defer for Tasks
  re-ordering (only scroll anchoring), status line hidden when all is well,
  "teammate's" label dropped (teammates' rows only exist in LEADY KOLEGŮ).
### 4. Refinements (user, 2026-11-12) — done
- [x] Messages rows: name + stage dot/label, time; snippet ("You: ") + unread
      pill. No WA/Email tags in rows or chat bubbles.
- [x] Draggable list width (Tasks + Messages share it): `role=separator`,
      pointer drag, ←/→ (Shift ×4), Home/End, double-click reset, localStorage
      with try/catch, clamped 240–640 px and to leave the chat 360 px; hidden ≤900px.
- [x] Composer talks to the AI only: no channel toggle, subject or own send;
      Enter = ✨, Shift+Enter = newline. Removed `POST /api/people/:id/send`
      and the `own` request flag. The UI no longer sends `channel` (server
      support kept).
- [x] Draft bubble read-only with two round buttons: ↑ green (`--ok`) send /
      open WhatsApp / mark meeting offered; × red discard (stop drafting,
      dismiss a failure). ⌘↩ no longer sends from the chat (Enter now runs ✨
      right next to it).
- [x] Chat header and Tasks rows lose the task line; Tasks rows show a draft
      as a spinner / accent dot / red dot after the name.
- Verified (isolated data, port 3102, headless Chrome over CDP): 257 chat rows
  with 0 tags, chat header 2 lines, drag 380→488 px, clamps 640/240, →→ 272,
  Shift+→ 336, reload keeps 336 in Tasks, double-click back to 380 and the key
  removed; Enter drafted (spinner on the row, "Stop drafting"), then
  "Open in WhatsApp to send" + "Discard draft"; a typed note disables ↑ and
  relabels ×; Shift+Enter added a line without a run; Enter regenerated
  (note + "Earlier draft" shown); × cancelled it. Light/dark, 1400/700 px.
  Send was never pressed. 96/96 tests.
- Next: dock badge in the macOS wrapper (observe `webView.title`); watch
  whether 45 "unread" chats on first run (client wrote last, never read in
  the app) is noise; a live new-WhatsApp check in the UI with a real message.
### 5. Editable drafts, batched learning (user, 2026-11-12) — done
- [x] The gray draft's text is editable in place: click or Enter/Space
      (focusable, "Edit draft", focus ring), email subject too, Enter =
      newline, Esc/blur ends; autosaved (PUT, 600 ms debounce), flushed
      before send (text sent with it), ✨ and ×. Only the text part is
      swapped, so the two round buttons stay the only buttons and keep
      working mid-edit; no re-render while editing. "edited by you" in the
      bubble's meta line when it differs from the AI's version.
- [x] Learning is batched (see the PLAYBOOKS update, phase 7).
- Verified (isolated data, port 3102, headless Chrome over CDP): click →
  textarea focused; Enter added a line (no ✨); "Saving…" → "Saved"; server
  text ends with the edit, `aiText` unchanged; Esc and blur end editing;
  Enter on the focused text reopens it; reload shows the edit + "edited by
  you"; × mid-edit discarded it → lesson with `<edited>`; Playbooks "1 of 15
  decisions collected · Learn now". Send was never pressed.


### 6. Requests folded into Messages (user, 2026-11-12) — done
- [x] The AI Requests section is gone (rail link, view, cards, History,
      Recover, cancel/regenerate dialog); drafts live in the chat only.
      ⌘1–5 now.
- [x] Messages has a Requests / Unanswered / All switch on top (open draft /
      unread / everyone, with counts; remembered in localStorage `mtab`; the
      open chat stays listed until another is picked).
- [x] Rail badge and title = waiting drafts + unread chats.
- Verified on the running app (headless Chrome over CDP): rail without
  Requests; badge 37 = 1 draft + 36 unread; Requests → 1 row, Unanswered →
  36, All → 257; no console errors; `npm test` 101 pass.
