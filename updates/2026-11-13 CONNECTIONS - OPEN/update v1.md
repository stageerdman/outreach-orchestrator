# CONNECTIONS — update v1: see what the orchestrator is wired to, add more by chatting

## Goal (user, 2026-11-13)
A new section, Connections. In the middle the orchestrator itself — an AI
engine, a bit Tony Stark (arc-reactor / HUD) — and around it what it is
connected to: today the CRM (ResultsON), WhatsApp and email. An "Add
connection" button starts Claude Code in the background (bypass permissions,
in this repo, so it can change the code and add plugins). The user says what
they want ("let the AI see my calendar and book things"), the AI asks where
it is and how to access it, the user answers in the chat, and it builds it.

## Decisions
- One CLI conversation per "Add connection": `claude -p --output-format
  stream-json --verbose --dangerously-skip-permissions`, cwd = the repo (so
  it reads CLAUDE.md), `--session-id` on the first turn, `--resume` after;
  one process per user turn, streamed to the UI over SSE (`connect`).
  One turn running at a time; Stop kills it. Kept in `connect.json` (app data):
  the transcript the UI shows (user text, AI text, one line per tool use).
- An appended system prompt: the user isn't a developer; one question at a
  time, plain words; follow CLAUDE.md (a new source = `lib/<name>.js`,
  tests, commit + push, no secrets or private data in git); register it in
  `lib/connections.js` so it shows in the diagram; secrets go in `.env`
  (never echoed back); explain before installing anything; say when the app
  needs a restart.
- `lib/connections.js`: the list the diagram shows — `{ id, name, what,
  status() → { state: live|off|error, detail } }` for CRM, WhatsApp, Email
  (from the existing *Configured() and the last refresh's errors); new
  connections add an entry.
- The look: the stage is its own dark HUD panel (tokens in index.html), the
  rest of the app unchanged; one font.

## Phases
1. [x] `lib/connections.js` + `GET /api/connections`; tests.
2. [x] `lib/connect.js`: the CLI conversation (spawn, stream-json → transcript,
   resume, stop, persist), routes, SSE; tests with a fake `claude`.
3. [x] UI: rail item, the reactor + nodes, Add connection, the chat (UX agents).
4. [x] Verify on the real thing (a real conversation on a test copy), UX review
   on screenshots, docs.

## Status
- 2026-11-13 planned; stream-json + resume checked by hand.
- 2026-11-13 built: backend + tests (127 pass), UI after 3 UX agents (diagram,
  chat, critique: finer layered reactor, lines touch it, status line above the
  button, one --hud accent in the chat, neutral Stop, key card, Restart as a
  bar). Verified on a copy: a scripted run (steps, key field, done, Restart,
  paste guard, 420 px) and one real turn — it looked around and asked one
  plain question ("Google Calendar, iCloud, Outlook, or Calendly?") without
  changing code. Restart tested (self-respawn); the Mac app rebuilt to restart
  the server on exit 75. Skipped: a pending node before the restart (the
  server only knows a connection after loading its code).

- 2026-11-17 v1.1, every AI sees every connection + a log per connection.
  Why: the Copilot answered "I have no access to your calendar" when asked
  for the Google Meet link — it had the free windows, but the calendar only
  ever gave busy/free, never the client's meeting. Done:
  1. [x] `lib/calendar.js`: SUMMARY, LOCATION, ATTENDEE/ORGANIZER, Meet link
     (X-GOOGLE-CONFERENCE, else the description); `occurrences()`;
     `clientMeetings()` (attendee email, or full name as attendee / in the
     title; −30…+60 days); `calendarForAI(person)` = free windows + those
     meetings, or a plain "couldn't be read (…)".
  2. [x] `CONNECTIONS[].ai` (`where` = already in the context, or `section`),
     `connectionsForAI` / `renderConnections`: a "# Your connections" block
     in drafts and the Copilot ("never say you have no access"), via
     `gatherConnections` in `lib/assistant.js`.
  3. [x] `lib/connlog.js` (`connlog.json`, app data, last 10 per direction):
     per prompt, the exact part each connection gave; per send, what went
     out (email, WhatsApp). `GET /api/connections/:id/log`, SSE `connlog`.
  4. [x] UI: a node opens its panel ("What the AI gets" / "What went out",
     samples folded, the newest open; "Change it with the AI" → the chat).
  5. [x] Tests (164 pass). Verified: the real Copilot turn on a copy of the
     app data found today's meeting and put its Meet link in the draft;
     the restarted app logs sends. Not yet looked at in a browser (the
     extension wasn't connected).

## Next (when we come back)
- Look at the connection panel in the app (wide, ≤900px).
- The user tries it in the real app: quit + reopen Outreach (the rebuilt
  ~/Applications/Outreach.app sets OUTREACH_SUPERVISED, so Restart = exit 75 →
  the app starts the server again and reloads). Not yet tried in the real app.
- First real connection (likely the calendar: see free slots, book meetings),
  built through the chat; watch that it registers in lib/connections.js and
  wires lib/assistant.js if drafts should offer real slots.
- Maybe: a "pending" node for a connection built but not loaded yet; stream
  the AI's text as it's typed (--include-partial-messages); more than one
  conversation / history.
