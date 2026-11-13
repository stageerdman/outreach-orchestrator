# CONNECTIONS — wiki

- `claude -p --output-format stream-json --verbose` emits system (hooks, init with session_id), assistant (content: thinking / text / tool_use), user (tool_result), rate_limit_event, result (is_error, result, total_cost_usd). `--resume <id>` continues with full context.

## Google Calendar (2026-11-13)
- First connection built from the chat. Read-only via each calendar's "Secret
  address in iCal format" — no OAuth app, no Google Cloud project, no install.
- The real feed uses DAILY/WEEKLY/YEARLY rules with INTERVAL, UNTIL, BYDAY,
  WKST, EXDATE, RECURRENCE-ID overrides, TZIDs Europe/Prague and Asia/Manila,
  TRANSP:TRANSPARENT; all handled in `lib/calendar.js` (wall-clock expansion in
  the event's zone, so DST keeps local times). Unknown FREQ = first occurrence only.
- Privacy: the AI gets free windows only, never titles or attendees.
- The CLI inherits the user's global hooks (SessionStart events show up as system lines); harmless, ignored.
- Headless Chrome screenshots of this view sometimes hang (infinite CSS animations + emulation changes); kill Chrome and rerun, navigate once per run.
- Secrets: the AI ends a message with `[[secret NAME: what it is]]`; the UI's secure field POSTs `/api/connect/secret`, which writes `.env` (mode 600), sets process.env and sends the AI only `[NAME saved to .env]`.
- Restart without the Mac app: the server spawns a detached copy of itself and exits; listen retries EADDRINUSE for ~5 s.
