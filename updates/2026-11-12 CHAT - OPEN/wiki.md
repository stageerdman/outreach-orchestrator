# Chat — wiki

- Fronta (ResultsON Cockpit queue) is ordered in the browser, not the DB;
  the rules are copied in `fronta-rules.md` (from ResultsON, 2026-11-12).
- The Cockpit source is the reference where `fronta-rules.md` is vague
  (`/Users/stage/dev/MAN 20/ResultsON`, `19-Cockpit.js` + `aktivniRezervace`
  in `16-ReklamyPrehled.js`). Followed it on: the meeting is the *latest*
  booking (unparseable time = no meeting, not an older one); zoneless ISO
  `meeting_at` ("2026-08-19T08:00", in real data) is Prague time; "meeting
  today" (950) = the live meeting is on today's Prague date.
- 3.4 filters a colleague's lead out when it falls in a "my zone" (triage /
  follow-ups) and isn't mine, so LEADY KOLEGŮ only holds their rows from the
  shared zones (new leads, no-shows, not reached…).
- Group-name tie-break (3.5) only matters for KAMPAŇ · name rows, which the
  main view drops; every main group has its own score.
- Speed: each PostgREST call costs ~0.3 s round trip + 0.3–0.6 s server/transfer
  from here; `count=exact` and projecting `meta` fields didn't help. What
  helped: no re-login (0.6–0.8 s) and fetching every page at once.
