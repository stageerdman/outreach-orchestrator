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

## UI spec (3 UX agents, synthesized 2026-11-13)
**Copilot column** (`#copilot`, moves with `#chat`, rendered only when a person
is open). ≥1200px: `list | chat | copilot`, `--cop-w: clamp(300px, 24vw, 400px)`,
no toggle, no second gutter; the list clamp subtracts `--cop-w`. <1200px: a
bottom sheet inside the chat pane (collapsed = the input + last reply line;
expands to 60% on focus, Esc collapses). `--panel` background, `border-left`,
`--accent` (not `--hud`); reuses the Connections chat pieces (`.xchat`).
- No header, no "New", no prompt chips. Placeholder "Enter drafts it · or tell
  me what you want"; first time ever one muted line "I can redo the draft,
  change a playbook ('from now on…'), or remember how you think."
- Turns: user = `.msg.me`; thinking streams in a muted ≤3-line box ("Thinking…"),
  folds into `<details>` "Thought for N s" when the reply starts (open state
  survives re-renders); reply rendered like the Connections chat; one line per
  action: `Draft updated · Show` (scrolls to + outlines the bubble 1 s),
  `Playbook "X", step 3: … · Open · Undo`, `Remembered: "…" · Undo`; undone →
  "Undone"; failure → error line + Try again.
- While running ↑ becomes ■ Stop (Esc stops too). A sent/discarded draft draws
  a divider ("Sent 14:02" / "Discarded"); older rounds fold into "Earlier".
- Keys: ⌘J focuses the copilot input from Messages/Tasks; Enter sends,
  Shift+Enter newline; **Enter on an empty input = ✨ (plain draft, as today)**;
  Enter/→ on a list row focuses the copilot input; Esc stops, else back to the
  list. Turns in `aria-live="polite"` (reply only).
**Conversation column:** the composer, `#chint` and the `.anote` / "Earlier
draft" trail go (that history is the copilot transcript now). Kept: the gray
bubble, edit in place, ↑ / ×, "edited by you", the stale line. × takes the
copilot input's text as the reason; ↑ is disabled while text is typed there
(title says why).
**Scenario line** (`.scene`, one line above the draft box, muted, like `.anote`;
only in the conversation, not in the copilot; channel never named; the
playbook name links to Playbooks at that step):
- no draft, step due: `New lead · step 2 of 4: ask for a call — Draft with:
  A · B · Write freely` (≤3 templates, one tap drafts with that templateId);
- client replied: `They replied — Reply as: Price objection · Needs time · Other`;
- not due: `No reply · step 3 of 4 due Fri (in 2 days) — Draft now anyway`;
- finished: `No reply · all 4 steps sent — Draft anyway · Edit playbook`;
- no playbook: `No playbook for <stage> — the AI will write freely`.
- With a draft, provenance replaces it (from the draft's recorded scenario, never
  live): `Followed No reply · step 2 of 4 · template "X"` (name toggles the
  template text inline), `· adapted` when the server's similarity to the filled
  template is < 70%; free: `Written freely — <reason>` (in `--text`). While
  generating: `Drafting from "X"…`.
**Playbooks: "What I learned"** replaces "What the AI learned" and the
"N of 15 · Learn now" counter (only failures stay, + rail "!"): first row,
grouped by run ("From your note on <name>" / "From N decisions" / "Copilot"),
each entry: person · the note quoted → outcome: Changed · <what> (Show change =
before/after of the changed field · Undo (N changes) on the run), Style guide ·
…, Already a rule · …, Kept for this chat only · <why> + **Make it the rule**
(re-runs that lesson as general). Runs that changed nothing from plain
sends/cancels get no entry.
