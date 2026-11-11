# Task feed — wiki

- ResultsON has no pipeline-stage field. Stage is derived from `hovory.vysledek`
  (nedovolano, triage, follow, termin, potvrzeno, zruseno, nekvalif, nevolat)
  and the task (`v_queue.kind` + `rule_name`). Tables readable with a
  team-member token include contacts, tasks, v_queue, hovory, poznamky,
  funnels, team_members; the OpenAPI root needs the service key.
- IMAP `UID FETCH N:*` always returns the newest message even when its UID is
  below N; filter `uid > lastUid` after fetching.
- Cached emails store the sender address, not `fromMe`: the same email can
  match two people, so `fromMe` is computed per person when read.
