# PLAYBOOKS — update v1

## Goal
Templates become **playbooks**: a follow-up strategy per pipeline stage (plus a
universal "no reply" one), each up to 10 steps — channel, wait, what we ask
and why — with template variants per step and branches for typical client
responses. The AI drafts from the playbook (knowing which step the client is
at), and **learns**: every approve, regenerate and cancel (with the user's
reason) can rewrite templates, add steps, branches or new paths, and lessons.

## Decisions
- Learning applies automatically (the user asked for it), and every change is
  logged with its trigger and reason and can be undone.
- Playbooks live in `playbooks.json` in the app data folder (never the repo);
  templates stay in `templates.json`, steps point at them.
- Step position comes from data: unanswered follow-ups since the client's
  last message and days since our last one.
- Strategy text (goal, why) in English; message texts in the client's language.

## Phases
1. [x] Research spike (agent): follow-up cadence strategies (multi-channel,
   why each ask) + the user's own data (reply rate by follow-up #, channel,
   gap, template), aggregates only → `research-playbooks.md`, build prompt.
2. [x] `lib/playbooks.js`: store, validation, operations, change log, undo.
   Tests.
3. [x] Drafting uses playbooks: follow-up position in the context, playbooks
   in the system prompt, `playbookId` / `stepId` on the draft. Tests.
4. [x] Learning (`lib/coach.js`): build from scratch; on approve / regenerate
   / cancel → Claude returns operations → applied + logged. Tests.
5. [ ] UI: Playbooks view (steps, branches, lessons, change log with undo).
   UX agents.
6. [ ] Verify on real data: build, draft, cancel with a reason → a change.

## Status
- 2026-11-11 started.
