# PERSONALIZATION — update v1

## Goal
The AI learns **how the user thinks**, not only how they write: explicit
if-then decision rules with the user's reasons and evidence, tested against
past decisions, and confirmed by **asking the user** now and then (a quick
A/B or yes/no on a real case) instead of assuming. A **Personalization** tab
shows what it has learned, what it is asking or testing now, and when it last
changed something. Method in `research-personalization.md`.

## Design (proposed)
- **Three layers, one owner each.** Voice → style guide (as now). Sequences
  → playbooks (as now). **Judgement → rules** (new): "if <situation>, then
  <what you do>, because <your reason>", scoped to stages/situation.
- **Rule record** (`rules.json`, app data folder): `id, if, then, because,
  stages[], kind (decide | voice | never), status (testing | active |
  rejected), source (inferred | confirmed | stated), support[], against[]`
  (lesson/answer ids), `examples` (≤2 anonymised cases), `createdAt,
  lastSeenAt`. Confidence is computed (support vs. against, confirmed
  counts double, fades when unseen for weeks), never typed by the AI.
- **Admission (agent-creator, adapted):** ≥2 supporting decisions; it must
  differ from what the AI did by default (an edit, a cancel or a note);
  active only when confirmed by you, or supported ≥4× with nothing against.
  Conflicts are kept, typed (newer wins / needs a scope / real tension) and
  turned into a question, never smoothed over.
- **Questions** (`questions.json`): `kind (ab | confirm | scenario)`, the
  rule it tests, a concrete anonymised case from your own lessons, options
  (always incl. "depends" / free text), answer, skipped. Made by the batch
  run only when worth it: a conflict, a rule on thin evidence, or a recurring
  situation no rule covers. ≤3 open, ≤1 new batch a day, never in the send
  flow; a skip = unknown; after repeated skips it asks less. An answer is
  evidence (source `confirmed`/`stated`) and a lesson for the next run.
- **The coach run** (`lib/coach.js`) grows rule operations (`setRule`,
  `retireRule`) and `questions` next to the playbook/template/style ops,
  logged and undoable like them. It's told: notes outrank edits outrank
  silent sends; voice goes to the style guide, judgement to rules.
- **Bootstrap:** one "distill" run over your past notes and edits
  (`requests.json`: 39 notes, 13 edited sends so far) proposes the first
  rules as `testing`, with their first questions.
- **Drafts use rules:** active rules (and testing ones, marked) in the
  system prompt by stage; the draft records `ruleIds`; its reasoning names
  the rule it followed.
- **Personalization tab** (rail, after Playbooks; Settings moves to ⌘6):
  1. *Asking you* — open questions as cards, answered in one click.
  2. *How you decide* — active rules grouped by stage, each with "from N
     decisions", source (inferred / you confirmed / you said), an example,
     edit · reject.
  3. *Still testing* — hypotheses, and what would settle them.
  4. *Recent changes* — the last learning run (when, N decisions, summary),
     the change log with undo (shared with Playbooks), "N of 15 decisions
     collected · Learn now".
  Quiet like the rest: only a rail dot when a question waits.

## Phases
1. [x] Research spikes (agents): agent-creator's extraction method; active
   preference elicitation literature → `research-personalization.md`.
2. [x] `lib/rules.js`: store, clean/validate, confidence + fading, rule ops
   in `applyOperations`' change log (undo). Tests.
3. [x] Coach: rule ops + question generation in the batch run (prompt +
   schema), the one-off distill run over past notes/edits. Tests on inputs.
4. [x] Questions (kept in `lib/rules.js`; answer/skip in `lib/coach.js`) + API: list / answer / skip; answers update the
   rule (source, support/against) and queue a lesson. Tests.
5. [x] Drafting: rules in the system prompt, `ruleIds` on the draft. Tests.
6. [x] Personalization tab (UX agents: questions cards, rules list, change
   log). Rail dot, ⌘ shortcuts.
7. [x] Verify on real data: distill on a copy of the app data, read the
   rules, answer questions, draft → the rule is cited.
8. [ ] Replay check (later): a separate run predicts held-out past decisions
   with/without the rules; a rule that doesn't help stays `testing`. A
   fidelity number (share of drafts sent unchanged, by week) in the tab.

## Decisions (user, 2026-11-12)
- Questions only in the Personalization tab (rail dot), never in the chat.
- Rules replace playbook lessons: a one-off migration (trigger `migrate`,
  undoable) turns each playbook's lessons into rules scoped to its stages;
  playbooks no longer get lessons (schema dropped them).
- Facts about the offer (kind `fact`, e.g. "the free consultation is free
  only for a limited time") are added by hand in the tab; the AI may propose
  them as testing. Drafts must not contradict them.
- One confirmation makes a rule active.

## Status
- 2026-11-12 started. Research done (phase 1).
- 2026-11-12 phases 2–5 done, 113 tests green (test/rules.test.js):
  `lib/rules.js` (rules.json: rules, questions, migrated flag; SSE
  `personal`), setRule/deleteRule ops in the change log with undo, coach
  batch emits rules + questions, `distill` over past noted/edited
  decisions, answers applied at once + queued as lessons, drafts get
  "# The user's rules" and return `ruleIds`. API: GET /api/personal,
  POST /api/personal/distill, POST|PUT|DELETE /api/rules[/:id],
  POST /api/questions/:id/answer|skip. Migration runs on server start.
- Phase 6 written, NOT yet checked in a browser: rail "You" (⌘5, Settings
  ⌘6, dot when a question waits), `#view-personal` (Asking you, How you
  decide by stage, About your offer, Still testing, Rejected, Recent
  learning with the log + Undo), rule edit in place. Script syntax checks.
- 2026-11-13 phases 6–7 verified on a copy of the app data (port 3102,
  headless Chrome over CDP; the Chrome extension wasn't connected): tab,
  rail dot, keys 1–4, answer → rule confirmed + lesson, add fact, edit,
  reject, Undo (merged edits undo together), delete, ≤900px without
  horizontal scroll, no console errors. Fixed: in-page `data-section` links
  (Playbooks → Personalization) now switch sections; an AI run adding
  evidence demoted the migrated active rules to testing (now an active rule
  stays active until a case against); migrated rules' "when" no longer
  repeats the playbook name. Distill over 49 past decisions: 4 new testing
  rules with the user's own reasons, 2 facts, 1 question, ~20 s. A draft
  cited `thinking-3` and `tykani`. Next: phase 8 (replay check, fidelity
  number).
- (2026-11-12, kept for history) Paused here at the user's request. Next:
  1. Run the app on a copy of the app data (port 3102), open
     Personalization: migration result, add a fact, edit/confirm/reject,
     Undo, a fake question (answer, skip, keys 1–4), ≤900px.
  2. Known gap: the "Personalization" link in the playbook editor is an
     `<a data-section>` outside `.rail`, so the rail's click handler doesn't
     catch it; wire it (or a hashchange listener).
  3. Press "Learn from my past decisions" on the copy (phase 7), read the
     rules and questions it proposes; then phase 8 (replay check).
  4. Update CLAUDE.md (sections list, Personalization notes, lessons → rules).
