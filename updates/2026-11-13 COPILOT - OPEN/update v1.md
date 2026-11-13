# COPILOT — update v1: playbooks that decide, an AI to talk drafts through, learning you can see

## Goal (user, 2026-11-13)
"It feels like I gave it a bunch of feedback and it still doesn't learn and
doesn't update the playbooks." Playbooks should be decision trees with
templates, so the AI mostly doesn't invent messages: it detects the scenario
the chat is in and picks the fitting template(s). In Messages, a third column
on the right: the AI that makes the messages, to really chat with (its
thinking, its replies). "Update the message" → it edits the draft I see;
"adjust the playbook, from now on we do it this way" → it changes the
playbook; "learn this about how I think" → it saves it.

## Diagnosis (real data, 2026-11-13)
- Since 2026-11-12 15:29 the user decided ~54 drafts (19 regenerated with a
  note, 3 more with a note + edit, 15 edited sends, 12 cancels). ~3 batch
  runs went over them and changed nothing (no logged change since the
  migrate). Notes vanish into a 15-decision batch whose prompt says "smallest
  change… returning no operations is fine", and the user never sees what
  happened to a note.
- Drafting treats playbooks as advice in a long prompt; the portrait
  "outranks the playbooks". Only 45 of 89 recent drafts used a template.
- Nothing tells the AI which step/branch it is at; it has to work it out.

## Decisions
- **Scenario detection** (`lib/scenario.js`, pure): code works out the
  playbook and, without a reply, the exact step (touches since the client
  last wrote → step N+1, wait passed or not); with a reply, the playbook's
  response branches are the candidates and the AI picks one. The draft
  prompt opens with that scenario and its templates; a draft records it.
- **Templates first, for real:** when the scenario has templates the draft
  uses one (placeholders filled, minimal adaptation); writing freely only when
  none fits, said in the reasoning. Order of authority: the user's
  instruction > the playbook scenario (what to send) > the portrait
  (judgment, how) > style (wording).
- **Learning you can see:** a decision with a note or an edit starts a coach
  run after a short quiet period (not after 15); plain sends/cancels still
  batch. The coach must account for every note/edit (`handled`: changed X /
  situational, why) and that log is shown in Playbooks.
- **Copilot** (`lib/copilot.js`): per-person chat with the drafting AI, in a
  third column next to the conversation (moves with `#chat`). Stateless turns
  (`claude -p`, stream-json, JSON schema `{thinking, reply, actions}`; the
  thinking and reply stream in live by partial JSON); each turn gets the same
  context a draft gets plus the scenario, the current draft and the copilot
  transcript. Actions: `draft` (create / replace the draft in front of the
  user, as a new version), playbook/template/style/fact operations
  (`applyOperations`, trigger `copilot`, undoable), `remember` (a mind note:
  how the user thinks). The composer moves into this column: one place to
  talk to the AI.

## Phases
1. [ ] Scenario detection + template-first drafting + learning fixes
   (scenario.js, assistant.js, coach.js, prompts); tests.
2. [ ] Copilot backend (copilot.js, routes, SSE `copilot`); tests with a fake
   `claude`.
3. [ ] UI: the third column, scenario line, learning log (UX agents in
   parallel, synthesized).
4. [ ] Verify on the real thing, docs (CLAUDE.md, wiki), close.

## Status
- 2026-11-13: diagnosis done, roadmap written.
