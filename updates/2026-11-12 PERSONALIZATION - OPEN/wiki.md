# PERSONALIZATION — wiki

- The user's notes on regenerate/cancel are the richest signal of how they
  think (39 in the first two days); edits show voice, notes show judgement.
- People can't dictate their own rules reliably (GATE: self-rated coverage
  drops once they see test cases). Ask on concrete cases from their own
  history, never "what are your rules?".
- Keep contradictions; type them (newer wins / needs a scope / real
  tension) and ask. Don't let the model invent a reconciling rule.
- A rule earns its place by predicting decisions, not by sounding wise:
  generic sales advice fails the exclusivity test.
- Observed decisions outrank stated answers when they disagree; the gap
  itself is worth a question.
- No fine-tuning, embeddings or Bayesian machinery: data is tens of
  decisions a day; plain JSON rules in the prompt are enough.

## v2 (agent-creator) lessons, 2026-11-13
- A flat rule list from notes predicted the user *worse than knowing
  nothing* (~31 vs ~35/100); the portrait from their own conversations
  ~39. The material matters more than the format: 1,476 own messages vs. 49
  notes.
- Measure before believing: one validation run moves ±5; compare averages,
  same cases, blind grader.
- Read the misses, not just the score: they exposed three bugs (logistics
  detected as "resistance", follow-ups after my own message dropped,
  rewritten drafts graded as "sent").
- Team templates (openers, closing notices, links) pass as "heuristics"
  unless the synthesis is told they belong to the playbooks.
