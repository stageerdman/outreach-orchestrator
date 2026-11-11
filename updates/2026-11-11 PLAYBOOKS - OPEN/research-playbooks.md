# Research: playbooks (follow-up strategy per stage)

Spike for phase 1 of PLAYBOOKS v1. Two parts: (A) what the user's own
outreach data says, aggregates only; (B) what published follow-up research
says. Then a synthesis: a playbook skeleton per stage, the response
branches, and a default prompt for the Claude run that builds the playbooks.
No message content, names, phones or emails are in this file.

## A. Evidence from the user's own data

**Method.** The script lives outside the repo (session scratch dir), runs on a
copy of `cache.db` (`OUTREACH_DATA_DIR` → copy), loads the snapshot with
`restoreSnapshot()` + `snapshotPeople()`, and only prints counts.
- Snapshot of 2026-11-11: **63 people, 716 messages** (Sep–Nov 2026, mostly
  Oct–Nov). WhatsApp 415 mine / 274 theirs; email **25 mine / 2 theirs**.
- **Touch** = a run of my messages on one channel, less than 2 h apart (the
  usual "two bubbles in a row" counts once). 385 touches.
- **k** = the touch's number since the client's last message (or since the
  start when the client never wrote: "cold").
- **Follow-up** = a touch sent after client silence: k ≥ 2, a cold touch,
  or k = 1 sent more than a day after the client's last message. 179
  follow-ups. The other 206 touches are direct replies (82 % answered in 3 d).
- **Reply** = the client's next message, credited only to my *last* touch
  before it (strict: an earlier touch in the streak counts as unanswered),
  within 3 / 7 days. Touches younger than the window and still unanswered
  are left out of that rate (the second n).
- **Template match** = word-trigram containment of a template body
  (placeholders removed) in the sent text, ≥ 40 %. 87 touches matched.
- **Stage** is the person's *current* stage, not the stage at send time —
  treat per-stage numbers as indicative only.

**Sample sizes are small.** Most cells have n < 30; anything with n < 10 is
anecdote. Read the numbers as direction, not proof.

### A1. Reply rate by follow-up number

| follow-up | n | reply ≤ 3 d | reply ≤ 7 d |
|---|---|---|---|
| cold #1 (first ever message) | 62 | 62 % | 65 % |
| cold #2 | 20 | 22 % | 25 % |
| cold #3 | 9 | 11 % | 13 % |
| cold #4–5+ | 8 | ~0–1 of 5 | — |
| #1 after the client wrote (he went quiet > 1 d) | 29 | 65 % | 71 % |
| #2 after the client wrote | 38 | 48 % | 56 % |
| #3 after the client wrote | 12 | 63 % (n=8) | 86 % (n=7) |

- **Cold leads decay fast**: a lead who never answered the first message
  answers a 2nd one ~1 in 4 times, a 3rd ~1 in 8. Steps 4+ to a never-replied
  lead had essentially no replies (n tiny). Late cold steps should be few,
  different in angle, and end with a close-the-file message.
- **Someone who already talked keeps answering**: #2–#3 after a real
  conversation still get ~50–85 %. Persistence pays far more with warm leads.
- Unanswered streak length per person: 1 touch 17, 2 → 27, 3 → 12, 4 → 4,
  5–6 → 2. The user rarely goes past 3; the templates go up to NA7.
- When replies come, they come fast: median **0.4 h**, p75 4.3 h after the
  follow-up. If nothing comes in a day, the touch most likely failed.

### A2. Channel and channel switches

| | n | ≤ 3 d | ≤ 7 d |
|---|---|---|---|
| WhatsApp follow-ups | 155 | 59 % | 64 % |
| Email follow-ups | 24 | **5 %** | 6 % |
| switched WhatsApp → email | 13 | 9 % | 10 % |
| switched email → WhatsApp | 9 | 50 % | 57 % |
| same channel as the previous touch (k ≥ 2) | 66 | 40 % | 50 % |

- **Email barely works for this audience** (1 reply in ~20 follow-ups).
  WhatsApp is the primary channel. Email is still worth one or two steps as
  a backup (another inbox; formal "your consultation details" / close-the-
  file messages) but should not be counted on for replies.
- Switching *to* WhatsApp after email silence helps; switching *to* email
  after WhatsApp silence doesn't. "Switch channel" isn't a lift on its own
  here — the channel itself is what counts.

### A3. Timing (gap since the previous message)

| gap | all follow-ups n | ≤ 3 d | repeat follow-ups (k ≥ 2) n | ≤ 3 d |
|---|---|---|---|---|
| < 1 d | 19 | 35 % | 19 | 35 % |
| 1–2 d | 24 | 48 % | 14 | 45 % |
| 2–4 d | 16 | **87 %** | 5 | 60 % |
| 4–8 d | 31 | 35 % | 24 | 39 % |
| 8 d + | 27 | 26 % | 26 | 22 % |

- Re-opening a conversation where the client went quiet: 1–2 d later 50 %
  (n=10), **2–4 d later 100 %** (n=10), 4–8 d later 20 % (n=5).
- Sweet spot: **2–4 days**. Same-day nudges and gaps over a week both do
  worse. (Confounded: long gaps are often already-cold leads.)

### A4. Message shape and templates

- Follow-ups with a **question**: 61 % vs 36 % without (3 d, n=95 / 61).
- **Short** (< 25 words) 59 % vs 25–60 words 38 % (3 d) — but for *repeat*
  WhatsApp follow-ups longer ones did better (57 % vs 40 %, n=14 / 40): a
  later step that brings something new/substantial beats another "ping".
- By template (all touches, 3 d reply):
  - Short "is this the right number / can I reach you here?" opener
    (`KONZULTACE: NA1 - Confirmation`): **86 %**, n=28 — the best performer.
  - Conversation-flow templates with a yes/no question (`KONZULTACE: FLOW1/2`,
    `LTO, FLOW-1`, `SPECIAL: FLOW1/2`): 13 of 13 answered (sent mid-
    conversation, so expected).
  - Booking-unfinished WhatsApp (`LEPŠÍ MILENEC, FLOW1`): 83 %, n=6.
  - Full meeting-details message (`KONZULTACE, WA: Full Potvrzení`): 0 %,
    n=10 — informational, no question; fine, it isn't meant to get a reply.
    The ask belongs in a separate short message.
  - Email confirmation (`LEPŠÍ MILENEC, Potvrzení`) 20 %, n=5; `No Show: NA1`
    0 of 2; `LTO: FLOW FINAL` (close-the-file) 0 of 2 in 3 d, 1 of 2 in 7 d.
  - 120 of 179 follow-ups were free text (no template match): 49 %.
- By prefix the KONZULTACE set leads (63 %, n=38); LEPŠÍ MILENEC 17 % (n=6)
  and LTO 25 % (n=4) are mostly email NA steps — the channel effect again.
- Template gaps: nothing for **Thinking about it** (post-consultation) or
  **Waiting for Payment** beyond the payment link; four "Untitled" entries
  (three empty). No-show has only NA1/NA2 (email).

### A5. Per stage (current stage, follow-ups, 3 d reply)

| stage | n | ≤ 3 d | first follow-up (k=1) | repeat (k ≥ 2) |
|---|---|---|---|---|
| Waiting for Payment | 16 | 75 % | 82 % (n=11) | 60 % (n=5) |
| Thinking about it | 47 | 53 % | 79 % (n=19) | 46 % (n=13), 70 % in 7 d |
| Answered | 38 | 59 % | 75 % (n=20) | 44 % (n=9) |
| Meeting Booked | 19 | 50 % | 63 % (n=8) | 38 % (n=8) |
| Meeting Confirmed | 23 | 41 % | 38 % (n=8) | 50 % (n=10) |
| **No Show** | 25 | **19 %** | 25 % (n=8) | 29 % (n=7) |
| Not answered / New lead | 7 | 60 % | — | — |
| Installment | 4 | 100 % | — | — |

- **No-shows are the hardest** (~1 in 5): they need a guilt-free re-book
  path and a short close, not more of the same.
- Post-consultation leads keep answering for weeks — a longer playbook pays.
- Funnels: LEPSIMILENEC n=140 (50 %), BOOTCAMP n=28 (52 %); others too small.
- Time of day: morning 50 % vs afternoon 52 % — no effect.

## B. Strategy research

Mostly B2B / vendor data (marked V); our leads are warm B2C on WhatsApp, so
take the direction, not the numbers. R = peer-reviewed / academic.

**Cadence and speed**
- Calling within 5 min vs 30 min: 100× the odds of contact, 21× of
  qualifying (R/V, MIT/InsideSales Lead Response study, 2007:
  mortech.com …/mit_study.pdf). Velocify (V, 3.5 M leads): 93 % of converted
  leads reached within 6 attempts; timing relative to the lead's activity
  matters 15× more than time of day (prnewswire.com, Velocify 2016).
- Follow-ups bring 42–59 % of all replies, but every step yields less than
  the previous; steps 5–7 add little and 4+ emails triple unsubscribes /
  spam complaints (V, woodpecker.co/blog/follow-up-statistics,
  belkins.io/blog/sales-follow-up-statistics).
- After a sales call: follow-up within 24 h → +14 % win rate; agreed next
  steps on the call → 20 % vs 5 % close (V, gong.io blog "driving next steps").

**Multichannel**
- A touch on another channel works as a reminder: calls roughly double
  email replies even unanswered; 3+ voicemails backfire (V, Gong Labs, 300 M
  calls). WhatsApp open ~98 % vs email ~21 % (V, Twilio benchmark via
  chatarmin.com). Matches A2: WhatsApp is the channel, email the backup.

**No-show prevention and recovery**
- SMS reminders cut no-shows ~25 % (R, BMJ Open meta-analysis of 21 RCTs,
  bmjopen.bmj.com/content/6/10/e012116). Ask for a reply ("does it still
  work?") instead of only notifying (V, RingCentral); reminders at 24 h /
  1 h (V, chilipiper.com/blog/how-to-handle-no-shows).
- Implementation intentions — the person states when/where he'll do it —
  raised attendance 92 % vs 69 % (R, Sheeran & Orbell 2000,
  eprints.whiterose.ac.uk/139998). → have him confirm the time and a quiet
  place himself.
- Re-booking after a no-show: no hard data; practice is same-day, no blame,
  two concrete slots, 1–2 follow-ups, then close / nurture.

**After the consultation (high-ticket)**
- "Need to think" usually hides one specific concern: ask which part
  (price, timing, results, partner) (A, practitioner courses).
- Short real deadlines beat long ones: a 2-week voucher was redeemed by
  > 30 %, a 2-month one by < 10 % (R, Shu & Gneezy, JMR 2010). One clear
  recommendation beats several options (R, Tversky & Shafir 1992 — weak,
  failed a 2023 replication).
- Instalments lift purchase likelihood ~9 % (R via secondary source;
  stripe.com/blog/testing-the-impact-of-buy-now-pay-later, V) — the answer
  to a price objection, not an opener.
- **Legal:** EU UCPD Annex I bans false "only for a very limited time"
  claims; deadlines must be real (commission.europa.eu, 2026 sweep).

**What each touch should do**
- Short + a question: 1–3 questions → ~50 % more replies than none (V,
  Boomerang, 2016); 20–39 words best for cold (V, hunter.io). Same as A4.
- Ask about *his* goal, not our offer ("is X still something you want to
  solve?", Dean Jackson's 9-word email, A). Interest-based yes/no CTAs book
  meetings; "not interested?" CTAs don't (V, Gong Labs).
- Breakup message: ~14 % reply — below the first follow-up, above late ones
  (V, optif.ai; pin.com nudge-vs-breakup study). A polite last step, not a
  trick.
- Every touch adds something new (angle, proof, resource, question); never
  "just checking in".

**Gaps:** no independent WhatsApp follow-up data, nothing Czech-specific,
nothing on post-consultation sequences for coaching — those steps rest on
principles, and the learning loop must test them.

## Synthesis

### 1. Playbook skeletons

Waits are days after the previous step. "WA" = WhatsApp. Every step must
change something — angle, value, ask or channel — never "just checking in".
Max 10 steps; most need fewer (data: cold replies collapse after step 3).

**P0 · No reply (universal, any stage; client wrote before and went quiet)**
1. WA, 2 d — pick up exactly where he left off; one easy question. *Why:*
   2–4 d is the best re-open window (A3); warm leads answer ~65 %.
2. WA, 3 d — new angle: a short insight about his problem (what usually sits
   behind it) + "is this still something you want to solve?". *Why:* value
   beats a ping; longer repeat steps did better (A4).
3. WA, 4 d — yes/no or A/B question ("now, or later this year?"). *Why:*
   lowest-effort reply; questions double reply rates (A4).
4. Email, 5 d — same offer, formal recap + one link. *Why:* a backup inbox;
   don't expect replies (A2).
5. WA, 7 d — close the file kindly: "I'll close your case so we stop
   writing; reply if you still want it." *Why:* the breakup gives
   permission to say no (or yes) and ends the sequence cleanly.

**P1 · New lead / Not answered (calls unanswered, never replied)**
1. WA, same day as the missed call — "this is Vlado, coach from …, can I
   reach you here?" *Why:* 86 % reply template; identity + tiny ask.
2. WA, 1 d — the reason in one line (his questionnaire / purchase / access).
   *Why:* explains the first ping; cold #2 still ~25 %.
3. Email, 2 d — "did your access / booking come through?" with the link.
4. WA, 3 d — "is <problem> something you want to solve now, or are you
   leaving it?" *Why:* binary, frames the choice.
5. WA, 5 d — close-the-file (free consultation closes). Stop.

**P2 · Answered (talked, no meeting booked)**
1. WA, 1 d — the booking link + two concrete slots ("Tue 18:00 or Wed
   10:00?"). *Why:* choice of two is easier than an open calendar.
2. WA, 2 d — what the consultation gives him (45 min, his situation, a
   plan). *Why:* answers the unspoken "what's in it for me".
3. WA, 3 d — one question about his problem (how long, what he tried).
   *Why:* re-engages through his story, not our calendar.
4. Email, 4 d — recap + link. 5. WA, 7 d — close-the-file.

**P3 · Meeting Booked (not yet confirmed)**
1. WA, right after booking — short "can I reach you here?" then the details
   message (link, time, prep video) separately. *Why:* the question gets the
   reply (86 %), the details message never does (0 %).
2. WA, 1 d before — "does <day> <time> still work?" (yes/no). *Why:*
   explicit confirmation is the strongest no-show reducer (B).
3. WA, morning of the day — reminder + prep video, ask for a 👍.
4. If no confirmation by 2 h before: email with the link + "reply if you
   need another time". *Why:* backup channel for the link only.

**P4 · Meeting Confirmed**
1. WA, the day before — prep video + "a quiet place for 45 min" (sets the
   commitment). 2. WA, 1–2 h before — the link, one line. 3. If he hasn't
   joined 5 min in: WA "I'm in the call, are you coming?" → hands over to P5.

**P5 · No Show** (hardest stage, ~20 % reply)
1. WA, same day (within 1 h) — no blame: "we missed each other, did
   something come up?" *Why:* fast and guilt-free gets the most re-books.
2. WA, 1 d — two new slots. *Why:* make re-booking a one-word reply.
3. Email, 2 d — formal "your free consultation" + re-book link.
4. WA, 3 d — the free consultation is one-time; keep it or close it?
   (yes/no). 5. WA, 7 d — close-the-file. Stop.

**P6 · Thinking about it** (consultation happened, no sale; warm, long tail)
1. WA, 1 d — recap of his goal and the plan from the call in 2–3 lines +
   "what's left open for you?" *Why:* re-anchors on his pain, surfaces the
   real objection.
2. WA, 2–3 d — answer the objection he named (branches below).
3. WA, 4 d — a relevant result/story of a similar man, no pressure.
4. WA, 5 d — the decision question: "yes, no, or not now?" *Why:* any
   answer moves the deal; "not now" → P0 later.
5. Email, 5 d — the offer in writing (price, installments, what's included).
6. WA, 7 d — honest deadline if one is real (spot/price held until <date>).
7. WA, 14 d — close-the-file, door open.

**P7 · Waiting for Payment**
1. WA, same day — the payment link + "tell me when it's done". 2. WA, 1 d —
"did the link work?" (technical framing). 3. WA, 2 d — offer installments if
price came up. 4. Email, 3 d — the link again, formal. 5. WA, 5 d — "should
I keep your place?" (yes/no) → P6 if it stalls.

**P8 · Installment** — not a sales sequence: friendly due-date reminder
(WA, 2 d before), "did it go through?" (WA, 1 d after), then hand to the user.

### 2. Response branches (shared across playbooks)

| when the client says | approach |
|---|---|
| No time now / busy | Acknowledge, offer two specific later slots or ask when is better; re-contact on that date. |
| How much / too expensive | Before the call: the consultation is free, price comes after we know his situation. After: cost of not solving it, installments, what's included. Never discount first. |
| Need to think | Ask what exactly he's weighing (one question); answer that; agree a concrete decision date. |
| Discuss with partner | Respect it; offer a short summary he can show her, or a joint call; agree when to follow up. |
| Not relevant anymore / solved | Congratulate, ask briefly what helped, close the file, door open. |
| Not now, later | Agree a month; schedule a P0 restart; one value message in between at most. |
| Doubts it works / tried before | Ask what he tried; explain what's different; offer the free diagnostic as low risk. |
| Embarrassed / private topic | Normalize (common, confidential), lower the ask (just a question by text). |
| Wrong number / wrong person | Apologize, close; mark for the user. |
| Technical (no link, can't pay, no access) | Fix first, resend the link, confirm it worked. |
| Stop / unsubscribe | Confirm, stop all steps, no further message. |
| Wants to reschedule | Two slots, confirm, restart P3. |

### 3. Default prompt for the build run

Default for `settings.json` (the user can edit it); the data blocks go
before it, like the style prompt: `<templates>` (id, name, subject, body),
`<stats>` (section A as JSON), `<style>` (the style guide), `<research>`
(section B + the skeletons above).

```text
You are designing follow-up playbooks for Vlado, a sales coach for the Czech
men's coaching program Muž 2.0. Leads come from ads or bought a low-ticket
offer (LTO). Goal of every lead: book the free diagnostic consultation
(45-min video call), show up, then buy the coaching (full or installments).
Vlado writes on WhatsApp and email; he calls from the CRM himself.

Pipeline stages, top first: Installment, Waiting for Payment, Thinking about
it (consultation happened, no sale yet), No Show, Meeting Confirmed, Meeting
Booked, Answered (call answered), Not answered, New lead.

Above you have: his templates <templates>, measured results from his own
outreach <stats>, his writing style <style>, and follow-up research with
draft skeletons <research>.

Build the playbooks:
- One playbook per situation: a universal "no reply" playbook (any stage,
  the client went quiet) plus one per stage or group of stages that need
  the same strategy. Use the exact stage labels above. situation is
  'no-reply' when the client stopped answering, 'conversation' when he is
  talking and we steer him to the next stage.
- goal: one sentence, the stage he should reach next.
- steps: 3–10, in order. waitDays = days after the previous step (0 = same
  day). channel 'whatsapp' unless there is a reason: the stats show email
  rarely gets replies here, so use email for formal material (links,
  recaps, the written offer) and at most one or two backup steps; 'any'
  only when it truly doesn't matter.
- ask: what this step asks the client for, concretely (one ask per step).
  why: the reason for this step at this moment, grounded in the stats or
  the research (e.g. "2–4 day gaps got the most replies", "a yes/no
  question is the easiest reply"). Each step must change something — the
  angle, new value, an easier question, or the channel. Never a bare
  "just checking in".
- Follow the evidence: warm leads (he wrote before) keep answering for
  several steps; cold leads (never answered) rarely answer after the 3rd
  touch, so keep cold sequences short and end with a polite close-the-file
  message. Questions and short messages get more replies; a later step
  that brings something new may be longer. Separate an informational
  message (meeting details, links) from the question that should be
  answered. No-shows: same day, no blame, two concrete slots.
- Deadlines and scarcity only when real (e.g. the free consultation is
  one-time; a real cohort date). Never invent urgency.
- responses: the typical replies for this playbook — no time, price, need
  to think, discuss with a partner, not relevant anymore, later, doubts,
  embarrassment, wrong number, technical problems, stop, reschedule — each
  with `when` (what the client says) and `approach` (how to answer and what
  to ask next). Only the ones that fit the playbook.
- templateIds: ids from <templates> that fit the step or response, best
  first. Reuse the existing templates wherever they fit; skip empty or
  "Untitled" ones. Where a step needs a message no template covers, add it
  to newTemplates (id "new-<slug>", referenced from templateIds) — written in
  Czech, in Vlado's style from <style> (formal "Vy", short, his openings and
  sign-offs), with {{ PLACEHOLDER }} fields like the existing templates.
  subject only for email templates.
- Strategy text (name, goal, ask, why, when, approach) in English; template
  texts in Czech. ids: short lowercase slugs, unique.

Return only JSON matching the schema:
{ playbooks: [{ id, name, stages: [stage labels], situation,
  goal, steps: [{ id, channel, waitDays, ask, why, templateIds }],
  responses: [{ id, when, approach, templateIds }] }],
  newTemplates: [{ id, name, subject, body }] }
```
