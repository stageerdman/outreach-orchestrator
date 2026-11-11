# AI REQUESTS — update v1

## Goal
Claude (headless `claude -p`, in the background) drafts follow-ups for tasks.
The user launches it per task or per stage group; each draft becomes an
**AI request** the user approves (Send email / Open WhatsApp), regenerates
with an explanation, or cancels with an optional reason. When a conversation
is ready for it, the AI asks the user to **book a meeting** instead (Done /
Cancel). A one-time **style learning** run turns the user's past replies into
an editable style guide; all prompts live in a **Settings** section.

## Decisions
- AI = `claude -p --output-format json --json-schema … --tools "" --strict-mcp-config
  --no-session-persistence`, prompt on stdin, run from the app data folder
  (no CLAUDE.md picked up). Uses the user's Claude Code login (not `--bare`,
  which needs an API key). Max 2 runs at a time.
- Requests, settings (prompts, style guide, model) are JSON files in the app
  data folder, never the repo (they contain message text).
- A person with a pending (or generating) request can't be generated again
  and is skipped by group batches.
- The AI sees the last messages of both channels, the task, the stage, the
  templates, the style guide, and its own earlier drafts that weren't sent
  (with the user's cancel / regenerate reasons).
- Email is sent over SMTP (`nodemailer`, same author as imapflow), as a reply
  to the last email when there is one, and appended to the Sent folder.
- WhatsApp: the server runs `open whatsapp://send?phone=…&text=…`; the
  request then counts as sent (handed off to the app).
- The CRM stays read-only: approving a request does not complete the CRM task.

## Phases
1. [x] Backend core: `lib/claude.js` (runner + queue), `lib/settings.js`,
   `lib/requests.js` (store + state machine), `lib/assistant.js` (context +
   generate + learn style). Tests: context building, request rules.
2. [x] Sending: `sendEmail` (SMTP + Sent append), WhatsApp open. API routes.
3. [x] Research spike: style-copying frameworks → `research-style.md`,
   default style-learning prompt.
4. [x] UI: arrow buttons in Tasks (row + group), pending badge; AI Requests
   section; Settings section. (UX agents' specs synthesized.)
5. [x] Verify on real data: learn style, generate for a few tasks (real
   WhatsApp open and email send left to the user). Docs (CLAUDE.md, wiki).

## Status
- 2026-11-11 started.
- 2026-11-11 phases 1–4 done, 42 tests green. Verified on real data: style
  guide learned (428 messages), 3 real drafts (one "book a meeting", two
  WhatsApp, one from a template), regenerate with a note. UI checked in
  headless Chrome (tasks arrows, group batch, cards, dialog, edit autosave,
  cancel, badge). Email sending checked against a local fake SMTP only.
- 2026-11-11 times in the AI's context are Prague time (was the Mac's local
  time). Stage fixes: self-booked meetings ("rezervoval si sám", "Domluvená
  schůzka") count as Meeting Booked; Installment sticks to the person
  (closed installment tasks, "Prodej na splátky" notes). Real data: 5 people
  moved Answered → Meeting Booked. 50 tests green.
- Next: the user sends a first real email and WhatsApp from the app; decide
  whether approving should also complete the CRM task.
