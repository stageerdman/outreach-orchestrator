# COPILOT — wiki

- Why feedback didn't stick (2026-11-13): notes went into a 15-decision batch
  whose prompt allowed "no operations"; ~3 runs over 22 notes changed nothing
  and nothing showed it. Fix: notes/edits learn after 3 quiet minutes, the
  coach must account for each one (`handled`), and the log is visible.
- Code decides where the client is (`lib/scenario.js`); the AI only picks
  among reply branches. Asking the AI to work out the step from a long
  prompt made it treat playbooks as advice.
- Some real playbooks marked `conversation` hold the long no-reply sequences
  (To be booked, Thinking about it); scenario selection prefers the stage's
  own playbook with steps for no-reply, whatever its situation label.
- `claude -p --json-schema` with `stream-json --include-partial-messages`
  streams the structured answer as `input_json_delta` chunks; putting
  `thinking` and `reply` first in the schema lets the UI show them live via a
  tolerant partial-string reader. No real thinking blocks come through.
- The drafting system prompt is Czech-heavy; without an explicit per-turn
  "reply in English" the Copilot answers English questions in Czech.
- Copilot draft replacements don't call `learnFrom` per message (would start
  a coach run per chat turn); the final send/cancel's lesson carries the
  chain's instructions as its note.
