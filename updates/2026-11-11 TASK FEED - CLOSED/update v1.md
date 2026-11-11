# Task feed — update v1 (CLOSED)

## Goal
The list becomes the feed of my open tasks, grouped by pipeline stage
(furthest along on top). Each person shows their stage, phone and email
(one-click copy) and what the task is. History is kept locally so a refresh
only fetches what's new instead of starting from zero.

## Starting state
- One row per person with an open task assigned to me (65; each has exactly
  one open task). Sorted by last contact. No task or stage info shown.
- History lives in memory: every server start re-downloads email and re-asks
  the phone for older WhatsApp history (~3–4 min).

## Pipeline (agreed with user; furthest first, by furthest stage reached)
1. Paying (installments) — `splatka` task
2. Bought LTO / upsell — task rule "LTO nákup…"
3. Consultation confirmed — any call result `potvrzeno`
4. Consultation booked — call result `termin`, or rule "Termín domluven…"
5. Consultation cancelled — call result `zruseno`, or rule "Zrušení konzultace…"
6. Follow-up — call result `follow`
7. Talked (triage) — call result `triage`
8. Questionnaire filled — rule "Dotazník vyplněn…"
9. New / not reached yet — everything else
Within a group: most overdue task first.

## Phases

### 1. Local cache — done
- [x] `lib/cache.js` (node:sqlite) in `~/Library/Application Support/Outreach/`
      (outside the repo; `OUTREACH_DATA_DIR` to override).
- [x] Last snapshot saved after every refresh and loaded at server start:
      the app opens with the last data instantly, then refreshes.
- [x] Email: header index and downloaded emails cached per folder (keyed by
      UIDVALIDITY + UID). A refresh reads only headers newer than the last
      seen UID and downloads only emails not cached yet.
- [x] WhatsApp: chats with nothing older on the phone are remembered, so a
      restart doesn't re-ask the phone for all of them.
- Ends with: tests (cache round trip, incremental UID ranges); real refresh
  timed cold vs warm.

### 2. Tasks and stages from the CRM — done
- [x] People come with their open task (kind, rule, due, note) and call
      results; the team-member id is looked up from the login instead of
      being hard-coded in `.env`.
- [x] `stageOf(task, callResults)` → one of the 9 stages above.
- Ends with: tests for `stageOf`; stage counts on real data.

### 3. UI: grouped task feed — done
- [x] Groups per stage (furthest first) with a header and count; empty
      stages hidden.
- [x] Row: name; task (what + when, overdue highlighted); stage, phone and
      email, each phone/email copyable with one click (with feedback).
- [x] Keyboard and screen-reader friendly (copy buttons outside the
      expand button, focusable, announced).
- UX experts in parallel: grouped list + row content/copy interactions.
- Ends with: headless UI check on real data, rebuild the Mac app.

## Decisions
- Cache lives outside the repo so private messages can't be committed.
- Stage = furthest reached, so a later missed call doesn't demote anyone.
- ResultsON moved to its own source `lib/resultson.js` (RESULTSON_* keys);
  team-member id looked up from the login. Generic CRM_URL path kept.
- Row: one button (name + due) with an invisible full-row overlay; copy
  buttons sit above it. Avoided `display: contents` on the button (WebKit
  has had accessibility bugs with it, and the app runs in WKWebView).
- Email/WhatsApp counts dropped from rows (the timeline filters show them).

## Results (real data)
- Cache: first refresh 165s (13s to list); after a restart the last data is
  there instantly and a refresh takes 7s.
- Stages for 65 people: paying 2, LTO 6, confirmed 18, booked 5,
  cancelled 2, follow-up 19, triage 8, new 5 (questionnaire 0: all moved on).
  47 overdue.
- UI checked in headless Chrome: group order/counts, due order, click
  anywhere opens, copy shows "Copied" without toggling, arrows from copy
  buttons, search by stage, no horizontal scroll at phone width, no errors.

## Status
- 2026-11-11: done; update closed.
