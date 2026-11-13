# PERSONALIZATION — update v2: a portrait of how you think (agent-creator)

## Why v2
v1 turned the user's notes into a flat list of when/then rules. The user
(2026-11-13): that's the old approach, not what should be the main thing;
use `/Users/stage/dev/agent-creator`'s method, which copies a person's
thinking and writing well — adapted, not copied whole. agent-creator
(a nuwa-skill fork) doesn't collect rules: it distills **a portrait** —
mental models, decision heuristics, how the person leads a conversation,
values, anti-patterns, tensions, honest limits — from **first-hand material**,
with every claim tied to evidence, and then has **independent agents test**
whether the portrait predicts what the person really did.

## What we take, what we leave
| agent-creator | here |
|---|---|
| First-hand material ranks highest | The user's own conversations: 1,476 messages, 616 replies to a client, 421 follow-ups after silence, plus 49 notes/edits on drafts and answers to questions. v1 used only the notes. |
| Phase 1: parallel research agents, one per dimension, each saves its findings | 4 research runs over the corpus: (A) how I reply in conversations, (B) hard moments — the client resists, postpones, doubts, declines, and what I do next, (C) my corrections of the AI's drafts (notes, edits: actual judgement vs. the AI's default), (D) how I treat clients who went quiet. Each finding labelled *said* (the user's own words about it) / *observed* (what they did) / *inferred*, with quotes; contradictions kept. Saved with the portrait. |
| Phase 2: triple verification (recurs in ≥2 contexts, generative, exclusive) → 3–7 mental models, 1–2 → heuristics, 0 → dropped | Same. "Exclusive" = not generic sales advice. |
| instructions.md sections | Portrait (`mind.json`, app data): who I am with clients (first person, short) · mental models (name, one line, evidence ≥2, apply when, limits) · heuristics 5–10 (if/then + a real case) · how I lead a conversation (agent-creator's 8 coaching-style dimensions: probing, challenge vs. support, pinning down specifics, handling resistance, reframing, arc, closing, signals I read — "not enough evidence" where thin) · values and what I never do · tensions (kept, not resolved) · honest limits (what's thin, what it's based on, date). Expression DNA = the existing style guide (no duplicate). Facts about the offer stay. |
| Phase 2.5 checkpoint: the person confirms before it's used | The tab shows the portrait; the user marks items "that's me" / "not me" or edits them. "Not me" is evidence for the next update. |
| Phase 4 + fidelity scorecard: separate answering and grading agents, known-stance tests, an edge case, never self-graded | Held-out real moments (the newest ~15% of conversations and notes, never shown to the synthesis): an answerer predicts what the user did and why, with the portrait and without; a blind grader scores the judgement (same / partly / different). One number with vs. without, shown in the tab. Replaces v1's replay of rules. |
| Update flow: incremental, add cases, don't rewrite | New decisions (the coach batch) and answers update the portrait: add evidence, adjust a heuristic, note a change of mind (temporal contradiction: newer wins, history kept). |
| Agentic protocol: look things up before answering | Drafting: the portrait goes in the system prompt as how the user thinks; the AI first reads the client through the models (and may decide not to write), then writes in the user's voice, and names the model/heuristic it followed. |
| Left out | Web research, cost tiers, source blacklists, intellectual lineage, timeline, role-play disclaimers, Phase 0B diagnosis, Phase 5 dual-agent refinement (maybe later). |

v1's rules: the confirmed/stated ones go into the synthesis as *said*
evidence; the rules list stops being the main view (heuristics live in the
portrait). Questions stay, but come from the portrait's thin areas and
tensions.

## Phases
1. [x] `lib/mind.js`: corpus (pure: dimensions A–D from the snapshot +
   requests, anonymised, hold-out split), research runs, synthesis,
   `mind.json` store, render for prompts. Tests on the corpus and render.
2. [x] Run on a copy of the app data; read the portrait. **Checkpoint with
   the user** before it's wired into drafts.
3. [x] Validation run (held-out, with vs. without, blind grader). Tests.
4. [x] Tab: the portrait as the main thing (UX agents), "that's me / not
   me", edit, the fidelity number; rules demoted.
5. [x] Drafting uses the portrait; drafts name the model/heuristic.
6. [x] Incremental updates from new decisions and answers; questions from
   thin areas.
7. [x] Verify on the copy, then docs (CLAUDE.md).

## Status
- 2026-11-13 planned after reading agent-creator (SKILL.md, extraction
  framework, fidelity scorecard, template, its wiki). Corpus measured on a
  copy: 258 people with messages, 1,476 of the user's messages, 616 reply
  pairs (~170k chars), 421 follow-ups, 38 pairs where the client resists.
- 2026-11-13 phases 1 and 3 built (test/mind.test.js), run on a fresh copy
  of the app data (~2 min to build, ~30 s to validate, the user's Claude
  login). Fixes found by reading the results: the "hard moment" detector
  caught scheduling logistics (now real pushback only: 29 moments); a
  follow-up right after my own earlier message was dropped (new touch after
  6 h); a rewritten-then-sent draft was graded as "sent it" (now "rewrote it
  and sent their own version"); team templates (opener, closing notice,
  links, prep video) crept in as heuristics (synthesis told to leave them to
  the playbooks; some still do). Validation, 41 held-out moments, 2 runs
  each: portrait ~39/100, nothing ~35, v1 rules ~31 (worse than nothing).
  Single runs spread ±5, so only averages mean anything. Weakest: clients
  who went quiet (the "closing notice" heuristic was relied on 7×, right
  0.5×). Waiting for the user's read of the portrait (checkpoint).
- 2026-11-13 the user: "good for now"; no per-item "that's me / not me",
  make it work long term. Done: the portrait keeps itself current (built
  when missing; rebuilt + re-tested after 10 new corrections, a new note, or
  a week with 3; checked 3 min after start and hourly); one "Tell it" box
  (notes outrank all research, shown as not-yet-in until the rebuild); the
  You tab shows the portrait (cards, evidence folded), the score and its
  history, drafts sent as written per week, facts. Drafts use portrait +
  facts and cite item ids. v1 rules, questions, distill and replay removed
  (code, routes, UI, tests); rules.json keeps the facts. Verified on the
  copy: tab (desktop, 420 px, no console errors), add fact, a draft citing
  priority-test / choice-in-his-hands, a test note changing the
  quiet-after-booking heuristic, auto re-test after it. Open: per-item
  feedback if wanted later; outcomes (booked / paid) as evidence.

## Questions from the AI (user, 2026-11-13)
"After a while" — not after every improvement — the AI looks at what
gathered (new corrections, notes) and asks about the thinking behind the
patterns it can't explain; one question at a time in the You tab, answer
(a suggested answer and/or own words) or skip; the count on the rail.
8. [x] `lib/mind.js`: questions in mind.json; asked when none are open and
   (never asked, or ≥15 new corrections/notes and ≥2 days since the last
   set); ≤5 per set, grounded in a real case, about why — never wording.
   An answer = the user's own words (a note, source `answer`); once the set
   is done the portrait rebuilds with them. Tests.
9. [x] API + You tab: a quiz card (n of N, why it asks, the case, suggested
   answers, own words, Answer / Skip), rail count. UX review on screenshots.
- 2026-11-13 questions built and reviewed (2 UX agents: visual, wording).
  From the review: 3 per set (not 5), one factor per question, options
  exclusive with "No fixed rule, I go by feel", no internal labels, a
  readable example above the question, a tap answers, "Not sure", Tell it
  secondary while a question is open, a calm count on the rail, the
  thank-you survives reloads. Verified on the copy: real questions
  generated, answer / one tap / not sure, focus to the next, the set's
  answers folded into a rebuild.
