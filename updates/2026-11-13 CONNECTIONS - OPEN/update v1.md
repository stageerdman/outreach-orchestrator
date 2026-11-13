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
3. [ ] UI: rail item, the reactor + nodes, Add connection, the chat (UX agents).
4. [ ] Verify on the real thing (a real conversation on a test copy), UX review
   on screenshots, docs.

## Status
- 2026-11-13 planned; stream-json + resume checked by hand.
