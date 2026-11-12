# PERSONALIZATION — research

Question: how should the AI learn how the user *thinks* (decision rules, what
they weigh), not only how they write, and when should it *ask* instead of
assume? Two spikes (2026-11-12): the agent-creator method
(`/Users/stage/dev/agent-creator`) and the literature on interactive
preference elicitation. Below: findings, then what fits this app and what
doesn't.

## Where we stand (real data, 2026-11-11 → 12)
- ~100 draft decisions in 2 days: 34 sent unchanged, 13 sent after edits,
  29 regenerated with a note, 9 cancelled with a note, 9 cancelled without one.
- **39 notes in two days.** These are the most reasoned signal we have
  ("too soon for an offer", "he never replied, don't send the link"). Today
  they become playbook lessons or style edits, or nothing. They never become
  explicit, checkable rules about *why* the user decides what they decide.
- Learning is passive: every 15 decisions one coach run edits playbooks,
  templates and the style guide. It never checks a rule against past
  decisions, and it never asks.

## 1. agent-creator (nuwa-skill fork): "how they think, not what they said"
- **Layers it extracts:** mental models (3–7), decision heuristics (5–10, "if
  X, then Y" + a case), expression DNA (voice), values and anti-patterns,
  tensions (values that conflict), honest boundaries.
- **Admission test ("triple verification"):** recurrence across ≥2 contexts,
  *generative* power (it predicts a new case), *exclusivity* (not every smart
  person thinks so). 3/3 → model, 1–2 → heuristic, 0 → dropped.
- **Contradictions are kept, not smoothed.** Three kinds: temporal (the view
  changed: the recent one wins, history kept), domain (different rule per
  context: scope both), real tension (record it as a tension). Never invent
  a reconciling story.
- **Provenance per finding:** said by the person / observed / inferred.
- **Rule format:** name · trigger · action · evidence (≥2 cases) · limits
  (when it fails).
- **Validation by separate agents:** known-stance replay (does the model
  answer like the person did?), an edge case (expected answer: "probably X,
  uncertain"), a voice test. The answering and grading agents are separate
  (self-grading was ~46 % accurate).
- **Pitfalls they recorded:** generic wisdom passed off as personal (fails
  exclusivity); forcing models out of thin data ("a 60-point model with
  honest limits beats a fabricated 90"); mixing the person's own material
  with material *about* them dilutes fidelity; self-description bias (people
  overstate some traits, miss blind spots).

## 2. Literature: learning preferences interactively
- **GATE** (Li, Tamkin, Goodman, Andreas 2023, arXiv 2310.11589): the model
  asks, the user answers. Answering felt *less* demanding than writing rules;
  yes/no and labelling examples were easiest. Users **overestimate how
  complete their own written rules are** (self-rated coverage 5.3 → 3.9 after
  seeing test cases). → Don't ask the user to write their rules; show cases.
- **OPEN** (Handa et al. 2024, arXiv 2403.05534): LLM names the features,
  experimental design picks the most informative question, LLM phrases it.
  → Keep competing hypotheses; ask what separates them best.
- **STaR-GATE** (Andukuri et al. 2024, arXiv 2403.19154): RLHF'd models
  under-ask; a question is good only if its answer would change the output.
- **PRELUDE / CIPHER** (Gao et al. NeurIPS 2024, arXiv 2404.15269): infer a
  written preference from each user edit, aggregate by context, put it in
  the prompt. Lower edit distance than raw edits, no fine-tuning. (Our
  design already resembles this.)
- **PROSE** (Aroca-Ouellette et al. ICML 2025, arXiv 2505.23815; already
  used for the style guide): refine the description, then **verify it across
  several samples** before keeping it: +33 % over CIPHER; adding a few raw
  examples next to the rules adds up to 9 %.
- **Inverse Constitutional AI** (Findeis et al. ICLR 2025, arXiv 2406.06560):
  turn choices into natural-language principles: generate → cluster →
  **test (keep only principles that predict held-out choices)**. The closest
  model for "extract how I think".
- **Critical Decision Method** (Hoffman, Crandall, Shadbolt 1998): tacit
  expertise surfaces by revisiting *specific hard cases* ("what did you
  notice, what would have changed your mind"), not by asking for rules.
- **Mixed-initiative** (Horvitz CHI 1999): interrupt only when the expected
  value of the answer exceeds the cost of the interruption.

### Question formats, by information per second of attention
1. **A/B, two drafts differing in ONE decision** (channel, timing, push vs.
   wait). ~2 s, reveals a choice rather than an opinion. Pitfall: if the
   drafts differ in several ways, the answer is ambiguous.
2. **Yes/no on a rule shown on a concrete case**, with a third option
   ("depends: on what?"). Pitfall: acquiescence; never phrase it leadingly.
3. **Scenario, "what would you do here?"** (3–4 options + free text).
   10–30 s, but surfaces the factors the user actually weighs. Rarely.
4. **Counterfactual** ("still send this if he had replied yesterday?"):
   finds a rule's *conditions*; use it once a rule is roughly confirmed.

Pitfalls across formats: stated ≠ revealed preference (weigh observed
decisions above answers and flag the gap); a tired user confirms everything
(if >90 % of questions are confirmed, they carry no information); ask about
reasoning, not wording.

### When to ask
Only when one holds: two rules conflict, or recent decisions contradict a
rule; a candidate rule has thin evidence (2–3 cases); a recurring situation
no rule covers. Batch with the learning run; ≤3 open questions; ≤1 new
batch a day; never mid-send; skipping costs nothing and means "unknown";
back off after repeated skips.

### Showing what was learned
Liked: readable, editable memory (Claude's per-project memory, ChatGPT's
review/delete). Disliked: unexplained personalization, memories the user
never asked for (a study: 96 % of ChatGPT memories were created unprompted),
deletions that don't stick. → Each rule with its evidence ("from 7
decisions, e.g. …"), inferred vs. confirmed, one-click confirm / reject /
edit, undo. Most valued: the draft saying which rule it applied, so the
correction lands on the reasoning.

## 3. What makes sense here
- **Rules, not only style.** A small set of if-then decision rules in plain
  language, each with scope (stages, situation), the user's reason, evidence
  (lesson ids for and against), source (inferred / confirmed / stated by
  you), confidence and last seen. Voice stays in the style guide; sequences
  stay in playbooks; rules hold the *judgement* across them.
- **agent-creator's admission test, adapted:** recurrence = ≥2 decisions,
  ideally different clients; generative = it predicts a held-out decision;
  exclusivity = it differs from what the default draft did (an edit, a
  cancel or a note already proves that). Fewer, honest rules.
- **Contradictions become questions**, typed as in agent-creator: the newer
  decision wins for now (temporal), or the rule gets a scope (domain), or it
  is recorded as a tension the user resolves.
- **Asking, sparingly:** A/B and yes/no on a real (anonymised) case from the
  user's own lessons; a scenario now and then for an uncovered situation.
  Triggered by conflict / thin evidence / no rule; generated by the same
  batch run; ≤3 open; answers become evidence (source "confirmed"/"stated").
- **Bootstrap from history:** one "distill" run over all past notes and edits
  (the 39 notes + 13 edited sends) proposes the first rules as hypotheses,
  so the questions start from evidence, not from zero.
- **Verification:** replay. A separate run predicts held-out past decisions
  with and without a rule; a rule that doesn't improve prediction stays a
  hypothesis. Also a running "fidelity" number: share of recent drafts sent
  unchanged.
- **Drafts cite rules** (`ruleIds` on the draft), so a regenerate note can be
  aimed at a rule and the rule's evidence grows or shrinks.
- **A Personalization tab** showing: what it is asking now, what it believes
  (rules with evidence and source), what it's still testing, when it last
  changed something (and undo).

## 4. What doesn't make sense
- Fine-tuning, RLHF/DPO, reward models: far too little data, and it breaks
  the "your own Claude login, `claude -p`" setup.
- Embeddings / a vector store: a few hundred lessons fit in context or filter
  by stage.
- Formal Bayesian question selection: approximate with "ask about the rule
  with the most conflicting evidence".
- Asking you to write your rules from scratch (GATE: people overestimate their
  own rules) or a daily questionnaire / a question per draft (fatigue).
- agent-creator's big pieces: 3–7 worldview "mental models", intellectual
  lineage, web research, role-play voice, its regex quality check. With
  dozens of decisions we support at most a few *priorities* plus heuristics.
- Questions inside the send flow, or auto-confirming a rule because the user
  didn't object.
