# AI REQUESTS — wiki

## Decisions
- Claude Code headless, not the API: `claude -p --output-format json
  --json-schema … --tools "" --strict-mcp-config --no-session-persistence
  --system-prompt …`, prompt on stdin, cwd = app data folder. `--bare` is out:
  it ignores the subscription login (API key only). The answer is in
  `structured_output`. ~3–15 s per draft with Sonnet.
- The system prompt (instructions + style guide + templates) is the same for
  every draft in a batch, so it caches; the per-person context goes in the
  user turn.
- Style learning follows `research-style.md`: pairs/follow-ups/stats are
  computed in Node, the model only writes the guide. On real data: 206 pairs,
  115 follow-ups, 428 own messages, ~112k chars in one call.
- Regenerate keeps the old draft as `regenerated` with the user's note; the
  next draft sees it. Cancel → `cancelled` + note. Retry closes the failed one.
- Open WA counts as sent the moment WhatsApp opens (no proof it was sent);
  the next refresh shows the real message.

## Lessons
- Headless Chrome (DevTools protocol) freezes page timers between protocol
  calls, whatever the flags; test polling UIs with one in-page async script.
- Two overlapping loads of `/api/requests` could apply an older answer last
  and stop polling; only the newest load's answer is applied now.
