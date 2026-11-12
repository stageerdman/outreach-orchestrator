# Fronta (call queue): ordering rules and API

*ResultsON · written 12. 11. 2026 from the code on branch `update/nedokonceno-followup-tabs` (identical to `main` for Fronta)*

Sources: `supabase/schema/30_views.sql` (`v_queue`), `supabase/schema/20_functions.sql` (`fn_apply_call_rules`, `f_task_pridej`), `cloudflare/pages/dashboard/components/19-Cockpit.js` (lines ~205–720, `nacti`, `skryt`, `skore`, `skupinaFronty`, `splatne`).

---

## 0. The main point

**The order you see in Fronta is computed in the browser, not in the database.**
`v_queue` has an `ORDER BY` (due first, then `tasks.priority`, then `due_at`), but the Cockpit throws that order away and re-sorts. It uses its own classification, which needs data from five other tables. So **no single endpoint today returns Fronta in the order you see it.** A custom app has two options:

| Option | What it means | Status |
|---|---|---|
| **A. Replicate** | Read the same PostgREST endpoints the Cockpit reads and run the same algorithm (section 3). | Works today; the reference implementation is in section 4. You have to keep it in sync with `19-Cockpit.js` by hand. |
| **B. One server function** (recommended) | Move the algorithm into a Postgres RPC `fn_fronta_vypis(p_clen uuid)` that both the Cockpit and your app call. | **Not built.** The proposed contract is in section 5. It fits the project rule "each metric = one function called everywhere". |

---

## 1. Where queue rows come from

A queue row is **one open task** (`tasks.status = 'open'`). Tasks are created by:

- **Trigger `fn_apply_call_rules`** on every new `funnel_events` row:
  - general rules from `call_rules`: `trigger_type` is `event` or `tag_added`. Each rule sets `delay_minutes`, `priority`, `kind`, `max_attempts` and `retry_minutes`. For `due_at`: a `confirm` task with a known meeting gets `meeting_at − 24 h`; any other task gets `occurred_at + delay_minutes`;
  - fixed rules: a no-show gives a `call` with the note "Nedorazil…" at +2 h (priority 30 if the consultation was paid, 60 if it was the first free one; after a 2nd free no-show the contact is tagged `stop-free-konzultace`). A cancelled paid consultation gives a `call` with the note "Zrušil…" at +2 h. A booking after 2 free no-shows gives a `confirm` immediately;
  - a phone-booked meeting (or a booking after triage), when the meeting is more than 24 h away: the open task changes to `kind='confirm'` with `due_at = meeting − 24 h`.
- **`f_task_pridej`**: **one open task per contact** at the DB level. If the contact already has one, the function appends to its note, takes the lower `priority` number and keeps the earlier `due_at`.
- `f_kampan_sync` / `f_reaktivace_sync` (campaign/reactivation tasks, `kind='kampan'`), plus manual creation in Cockpit, Sales and Konzultace.

`tasks.kind` values: `call`, `confirm`, `followup`, `splatka`, `kampan`. `tasks.follow_typ` values: `domluveny`, `konzultace`, or null.

> `tasks.priority` / `call_rules.priority` decides **only** which value wins when tasks merge in `f_task_pridej`. It does **not** affect the visible order.

---

## 2. Data the algorithm needs (per contact in the queue)

| Signal | Source | Meaning |
|---|---|---|
| task fields | `v_queue` | `task_id, kind, due_at, is_due, attempts, note, assigned_to, contact_id, name, phone, funnel…` |
| lock, follow_typ, created_by, created_at | `tasks` | `locked_by` / `locked_at`: someone is calling right now (20 min lock) |
| owner_id, nerelevantni, created_at | `contacts` | lead owner (set on the first connected call); "irrelevant" flag |
| call history | `hovory` (`dovolano, zahajen_at, vysledek`) | number of calls, last connected call; `vysledek in (triage, termin)` means triage is done |
| funnel events | `funnel_events` where `event in (call_booked, appointment_rescheduled, appointment_cancelled, reassigned, show, show_no_offer, show_offer, no_show, won, lost)` | the live meeting, its owner, whether it is resolved, whether the contact is closed, whether the contact has had a meeting |
| campaigns | `kampane` (`id, nazev, stav`) | a `kampan` task is visible only while `stav='bezi'` (campaign id is the `#K<id>` tag in `note`) |
| deletion requests | `v_smazani_zadosti?stav=eq.ceka` | a contact waiting for deletion is hidden from everyone |
| team | `team_members` (`id, jmeno, ghl_jmeno`) | maps a calendar name to a team member |

### Derived per-contact facts

- **meeting** = the latest `call_booked` or `appointment_rescheduled` with a parseable `meta.meeting_at`.
- **resolved** (`odbaveno`) = the meeting is **cancelled** (an `appointment_cancelled` after the booking, with the same time ±1 min or no time given) **or done** (`show*`, `no_show` from `meeting − 20 min` on, or `won`/`lost` after the booking).
- **live meeting** = a meeting that is not resolved and is in the future.
- **multiple bookings** (`vicRez`) = more than one active future booking (`aktivniRezervace`: same time = one meeting, cancelled = not counted, same GHL `appointment_id` = one meeting).
- **triage done** = a `hovory` row with `vysledek` `triage` or `termin`, **or** `"triage ✓"` in the task note.
- **closed** = has a `won` or `lost` event.
- **had a meeting** (`poSchuzce`) = has a `show`, `show_offer` or `show_no_offer` (no-show and cancellation don't count).
- **has history** = at least one call **or** at least one of the funnel events above.
- **last interaction** (`posledni`) = the latest of: the newest funnel event above, `contacts.created_at`, the last connected call.
- **meeting owner** (`komu`) = a `reassigned` event after the booking (its `meta.obchodnik_id`) wins. Otherwise `meta.obchodnik` from the booking, matched to `ghl_jmeno` / `jmeno`.

---

## 3. The rules, in order

### 3.1 Hide (row is never shown)
A row is hidden if **any** of these is true:
1. `kind='confirm'` and the meeting is resolved, the contact is closed, or the meeting doesn't need confirming. It doesn't need confirming when it is already in the past, or when it is **today before 9:00 Prague time** (handled in person).
2. `kind='kampan'` (except reactivation) and the campaign is missing or `stav ≠ 'bezi'`.
3. The contact has a pending deletion request.
4. `contacts.nerelevantni = true`.
5. **Locked by someone else**: `locked_by ≠ me` and `locked_at` is less than 20 min ago.

### 3.2 One contact = one row
If a contact has several visible tasks, the winner is the one with the highest kind priority: `confirm`=3 › `splatka`=2 › anything else=1 › `kampan`=0. Ties go to the earliest `due_at`.
- The winner is flagged `_kvalifikovat` if it is a `confirm` and one of the losing tasks was a priority-1 task with no attempts. That means the caller must still qualify the person on the confirmation call.
- ⚠️ **Side effect:** the Cockpit **closes the losing tasks** (`status='done'`, note "uzavřeno automaticky…"). A second app doing the same would race it. Read-only clients should merge only in memory.

### 3.3 Group and score (the first matching branch wins)

| # | Score | Group (`skupina`) | Condition | Colour |
|---|---|---|---|---|
| 1 | 300 | LEADY KOLEGŮ | the contact has an `owner_id` ≠ me **and** the task is not `assigned_to` me | C grey |
| 2 | 1000 | VÍC REZERVACÍ | multiple active bookings (blocks the calendar) | B green |
| 3 | 970 | TRIÁŽ | (`confirm` **or** live meeting) **and** live meeting **and** not closed **and** triage not done (target: within 5 min of booking) | B |
| 4 | 960 | DOMLUVENÝ FOLLOW-UP | not "follow-up after consultation" (row 8) **and** (`follow_typ='domluveny'` **or** `kind='followup'`) | **A purple** |
| 5 | 950 / 900 | POTVRZENÍ SCHŮZKY | `confirm` **or** live meeting. 950 if the meeting is **today**, 900 otherwise | B |
| 6 | 800 | NOVÝ LEAD | `call`, `attempts=0`, not a no-show, **no history**, no `follow_typ` | B |
| 7 | 790 | NO SHOW | `call` and the note matches `/Nedorazil\|Zrušil/i` | C |
| 8 | 780 | FOLLOWUP PO KONZULTACI | kind ∉ {confirm, splatka, kampan} and (`follow_typ='konzultace'` or (had a meeting and the note doesn't contain "Nedorazil")) | C |
| 9 | 750 | SPLÁTKY | `kind='splatka'` | B |
| 10 | 420 | REAKTIVACE | `kampan` created by `created_by='reaktivace'` | C |
| 11 | 400 | KAMPAŇ · {name} | other `kampan` | C |
| 12 | 760 | VRÁCÍ SE | `attempts=0` (has history) | C |
| 13 | 700 | NEDOVOLANÉ | everything else (`attempts>0`) | C |

Resulting **visible order** (by score, descending):
`VÍC REZERVACÍ 1000 › TRIÁŽ 970 › DOMLUVENÝ FOLLOW-UP 960 › POTVRZENÍ dnes 950 › POTVRZENÍ 900 › NOVÝ LEAD 800 › NO SHOW 790 › FOLLOWUP PO KONZULTACI 780 › VRÁCÍ SE 760 › SPLÁTKY 750 › NEDOVOLANÉ 700 › (REAKTIVACE 420 › KAMPAŇ 400 — separate view) › LEADY KOLEGŮ 300`

### 3.3a How a contact gets its group, in plain words

The checks run **in this exact order, and the first one that matches decides the group**, even if later ones would also match. This check order is **not** the same as the display order (that comes from the score).

1. **LEADY KOLEGŮ (colleague's lead).** The contact has an owner who isn't you, and the task isn't assigned to you. A contact gets an owner the first time a call to them connects; whoever reached them owns them. This check runs first, so a colleague's lead stays here even if it would also match a later group. Shown at the very bottom.
2. **VÍC REZERVACÍ (several bookings).** The contact has more than one future booking that hasn't been cancelled. Two bookings at the same time count as one meeting, and so does a GHL reschedule that keeps the same appointment id.
3. **TRIÁŽ (triage).** All of these are true: the contact has a future meeting that hasn't been cancelled or already had a result; they haven't bought or been lost; triage isn't done yet. Triage counts as done if there is a call with the result `triage` or `termin`, or the task note contains "triage ✓".
4. **DOMLUVENÝ FOLLOW-UP (agreed follow-up).** The client said "call me then". In the data, that means the task is marked `follow_typ = domluveny` or it is a `followup` task. One exception: if it also counts as a follow-up after a consultation (group 8), group 8 wins.
5. **POTVRZENÍ SCHŮZKY (meeting confirmation).** The task is a confirmation task, or the contact has a future meeting (which also covers people whose triage is already done). Meetings today rank higher than later ones.
6. **NOVÝ LEAD (new lead).** All of these are true: it is an ordinary call task; nobody has called about it yet; it isn't a no-show; it has no follow-up mark; the contact has no history at all. "History" means any call, or any booking, meeting, cancellation, sale or loss.
7. **NO SHOW.** A call task whose note contains "Nedorazil" (didn't show up) or "Zrušil" (cancelled). The database writes those notes when it creates the task after a no-show or a cancelled paid consultation.
8. **FOLLOWUP PO KONZULTACI (follow-up after a consultation).** The task isn't a confirmation, instalment or campaign task, and one of these is true: the task is marked `follow_typ = konzultace`; or the client actually attended a meeting (a `show`, `show_offer` or `show_no_offer` event; a no-show or a cancellation doesn't count) and the note doesn't say "Nedorazil".
9. **SPLÁTKY (instalments).** The task is an instalment task.
10. **REAKTIVACE (reactivation).** A campaign task created by the reactivation job.
11. **KAMPAŇ · name (campaign).** Any other campaign task. The campaign comes from the `#K<id>` tag in the note.
12. **VRÁCÍ SE (coming back).** Nobody has called about this task yet, but the contact has history from before.
13. **NEDOVOLANÉ (not reached).** Everything left: someone has already called about this task and it is still open, usually because they didn't get through.

**What it actually looks at.** The groups come from four kinds of facts:
- **The task:** what kind it is, how many call attempts it has, the follow-up mark, who it's assigned to, who created it, and the **text of its note**.
- **The contact:** who owns it.
- **Calls:** whether there were any, and whether triage was done.
- **Events:** bookings, cancellations, show or no-show, sale or loss, reassignment. These tell it whether there is a future meeting, whether the client attended one, and whether they bought or were lost.

**Weak spots.**
- **No-show detection depends on note text.** A no-show is recognised only by the words "Nedorazil" or "Zrušil" in the task note, and triage partly by "triage ✓". If someone edits the note, the contact can move to a different group.
- **Group 5 catches almost anything with a meeting.** A contact with any future meeting lands in POTVRZENÍ, whatever kind of task they have. This is deliberate: the task kind can drift out of date when a late cancellation arrives from GHL.
- **New lead vs. coming back:** the only difference is whether the contact has any history.

### 3.4 Who sees what (personal focus)
A row is in the **"call now"** list (`splatne`) when:
- `is_due` (`due_at ≤ now`) **or** multiple bookings (which shows even if not due), **and**
- multiple bookings, **or** the row is not in a "my zone", **or** it is mine.
  - **"My zones"** = TRIÁŽ, FOLLOWUP PO KONZULTACI, DOMLUVENÝ FOLLOW-UP.
  - **Mine** for TRIÁŽ: the meeting is on my calendar (`komu = my name`). If the owner is unknown, everyone sees it.
  - **Mine** for the others: `assigned_to = me` **or** `owner_id = me` **or** (no owner **and** not assigned).

All other zones (new leads, no-shows, instalments…) are shown to everyone.

### 3.5 Sort inside the list
1. score, descending;
2. group name (Czech collation), which keeps sections together;
3. **live meeting time, ascending.** Rows with a future meeting come before rows without one;
4. **last interaction, descending** (newest first; falls back to `due_at`). This gives speed-to-lead for new leads.

### 3.6 Views
- **Main Fronta** = `splatne` without `kind='kampan'`.
- **Reaktivace view** = only `kind='kampan'`, grouped: PO ZTRÁTĚ (`lost_duvod ∈ {nacasovani, penize, konkurence}` from `f_pipeline`) / PO NEDOVOLÁNÍ / KAMPAŇ · name. Within a group, newest interaction first.
- **"Později"** (later) = visible, not due, not multiple bookings, not `kampan`.
- The header count ("Volat teď") = `splatne.length`. The Pipeline badge uses the same number.

### 3.7 Self-healing (a write the Cockpit makes on load)
The Cockpit reschedules a task to `kind='confirm'`, `due_at = meeting − 24 h` when all of these are true:
- the contact has a live meeting more than 24 h away;
- triage is done, or the booking has `puvod='navolano'`;
- the task is due earlier than `meeting − 24 h`.

The DB trigger (section 1) does the same thing for new bookings. A custom app should **not** repeat this write.

### 3.8 Refresh
The Cockpit polls `v_queue` every 15 s. It skips polling during a call and after more than 5 min of inactivity. It plays a chime for a genuinely new lead: a `call` with 0 attempts, no history, no `follow_typ`, created less than 10 min ago.

---

## 4. Option A: replicate today (read-only REST)

**Base URL:** `https://<project>.supabase.co/rest/v1/` (the project URL is in `cloudflare/pages/dashboard/core/01-constants.js`).
**Auth:** Supabase Auth. Sign in a real team member and send:

```
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <user access_token>
```

RLS limits every table to the user's company (`location_id = fn_system_moje_firma()`). **Never ship the service-role key in a client app**: it bypasses RLS and sees every company. Paginate with `Range: 0-998` (server max rows = 1000) and a stable `order`.

```http
# 1) the queue
GET /rest/v1/v_queue?select=*&order=task_id.asc

# 2) enrichment (batch contact/task ids, ≤80 per request)
GET /rest/v1/tasks?id=in.(…)&select=id,locked_by,locked_at,follow_typ,created_at,created_by
GET /rest/v1/contacts?id=in.(…)&select=id,owner_id,nerelevantni,name,phone,email,created_at
GET /rest/v1/hovory?contact_id=in.(…)&select=contact_id,dovolano,zahajen_at,vysledek
GET /rest/v1/funnel_events?contact_id=in.(…)&event=in.(call_booked,appointment_rescheduled,appointment_cancelled,reassigned,show,show_no_offer,show_offer,no_show,won,lost)&order=occurred_at.desc&select=contact_id,event,meta,occurred_at
GET /rest/v1/kampane?select=id,nazev,stav
GET /rest/v1/v_smazani_zadosti?stav=eq.ceka&select=contact_id
GET /rest/v1/team_members?select=id,jmeno,ghl_jmeno

# 3) only for the Reaktivace grouping
POST /rest/v1/rpc/f_pipeline   {}
```

### Reference implementation (TypeScript, mirrors `19-Cockpit.js`)

```ts
type Row = VQueueRow & { ctx: Ctx };  // ctx = derived facts from section 2
const LOCK_MS = 20 * 60e3;

const isNoShow   = (r: Row) => r.kind === "call" && /Nedorazil|Zrušil/i.test(r.note ?? "");
const followKonz = (r: Row) => !["confirm","splatka","kampan"].includes(r.kind)
  && (r.ctx.followTyp === "konzultace" || (r.ctx.hadMeeting && !/Nedorazil/i.test(r.note ?? "")));
const agreedFU   = (r: Row) => !followKonz(r) && (r.ctx.followTyp === "domluveny" || r.kind === "followup");
const hasMeeting = (r: Row) => r.kind === "confirm" || !!r.ctx.liveMeeting;
const triage     = (r: Row) => hasMeeting(r) && !!r.ctx.liveMeeting && !r.ctx.closed
  && !/triage ✓/.test(r.note ?? "") && !r.ctx.triageDone;
const isNew      = (r: Row) => r.kind === "call" && !r.attempts && !isNoShow(r) && !r.ctx.hasHistory && !r.ctx.followTyp;
const colleague  = (r: Row, me: string) => !!r.ctx.ownerId && r.ctx.ownerId !== me && r.assigned_to !== me;
const reakt      = (r: Row) => r.kind === "kampan" && r.ctx.createdBy === "reaktivace";

export function classify(r: Row, me: string): [number, string] {
  if (colleague(r, me))     return [300,  "LEADY KOLEGŮ"];
  if (r.ctx.multiBooking)   return [1000, "VÍC REZERVACÍ"];
  if (triage(r))            return [970,  "TRIÁŽ"];
  if (agreedFU(r))          return [960,  "DOMLUVENÝ FOLLOW-UP"];
  if (hasMeeting(r))        return [r.ctx.meetingToday ? 950 : 900, "POTVRZENÍ SCHŮZKY"];
  if (isNew(r))             return [800,  "NOVÝ LEAD"];
  if (isNoShow(r))          return [790,  "NO SHOW"];
  if (followKonz(r))        return [780,  "FOLLOWUP PO KONZULTACI"];
  if (r.kind === "splatka") return [750,  "SPLÁTKY"];
  if (reakt(r))             return [420,  "REAKTIVACE"];
  if (r.kind === "kampan")  return [400,  "KAMPAŇ · " + (r.ctx.campaignName ?? "navolávání")];
  if (!r.attempts)          return [760,  "VRÁCÍ SE"];
  return [700, "NEDOVOLANÉ"];
}

export function hidden(r: Row, me: string, now = Date.now()): boolean {
  const c = r.ctx;
  return (r.kind === "confirm" && (c.meetingResolved || c.closed || (c.meeting && !needsConfirm(c.meeting, now))))
    || (r.kind === "kampan" && !reakt(r) && c.campaignState !== "bezi")
    || c.pendingDeletion || c.nerelevantni
    || (!!c.lockedBy && c.lockedBy !== me && now - Date.parse(c.lockedAt ?? "0") < LOCK_MS);
}
// needsConfirm: false if the meeting is in the past, or today (Prague time) before 09:00

export function callNow(rows: Row[], me: {id: string; jmeno: string}): Row[] {
  const visible = mergePerContact(rows.filter(r => !hidden(r, me.id)));   // section 3.2, in memory only
  const myZone = (r: Row) => triage(r) || followKonz(r) || agreedFU(r);
  const mine = (r: Row) => triage(r)
    ? (r.ctx.meetingOwnerName ? r.ctx.meetingOwnerName === me.jmeno : true)
    : r.assigned_to === me.id || r.ctx.ownerId === me.id || (!r.ctx.ownerId && !r.assigned_to);
  return visible
    .filter(r => (r.is_due || r.ctx.multiBooking) && (r.ctx.multiBooking || !myZone(r) || mine(r)))
    .map(r => ({ r, k: classify(r, me.id) }))
    .sort((a, b) => (b.k[0] - a.k[0])
      || a.k[1].localeCompare(b.k[1], "cs")
      || cmpMeeting(a.r.ctx.liveMeeting, b.r.ctx.liveMeeting)        // future meeting asc; meeting before none
      || (lastTouch(b.r) - lastTouch(a.r)))                          // newest interaction first
    .map(x => x.r)
    .filter(r => r.kind !== "kampan");                               // main view; the Reaktivace view keeps only kampan
}
```

### Acting on a row (to behave like Fronta)
```http
PATCH /rest/v1/tasks?id=eq.{task_id}       {"locked_by": "<my team_member id>", "locked_at": "<now>"}   # claim: hidden from others for 20 min
POST  /rest/v1/hovory                      {"contact_id","task_id","volal","zahajen_at","pokus": attempts+1}
PATCH /rest/v1/hovory?id=eq.{id}           {"ukoncen_at","dovolano","vysledek"}
PATCH /rest/v1/tasks?id=eq.{task_id}       {"status":"done","done_at":"<now>"}   # only for final outcomes
```
Final outcomes that close the task: `termin, nekvalif, neplatne, spatne_cislo, nevolat, potvrzeno, zruseno, prodej, neprodej, schuzka, jinde`. `triage` with the meeting more than 24 h away keeps the task open, moves it to `meeting − 24 h` and adds `"triage ✓"` to the note. Record `won`/`lost` as `funnel_events` **before** you close the task (money first).

---

## 5. Option B: proposed API `fn_fronta_vypis` (not built)

One `security invoker` SQL function. It respects RLS, and it becomes the **single source of truth** for the order. The Cockpit, Pipeline and your app all call it.

```http
POST /rest/v1/rpc/fn_fronta_vypis
{ "p_clen": "<team_member uuid>", "p_pohled": "fronta" | "reaktivace" | "pozdeji" }
```

Returns rows that are **already filtered, merged and sorted**:

| column | type | |
|---|---|---|
| `poradi` | int | 1…n, the final position |
| `task_id`, `contact_id`, `kind`, `due_at`, `attempts`, `note` | | from `v_queue` |
| `skupina` | text | e.g. `NOVÝ LEAD` |
| `skore` | int | 300…1000 |
| `barva` | text | `A` / `B` / `C` |
| `schuzka_at` | timestamptz | live meeting, if any |
| `schuzka_komu` | text | whose calendar it is on |
| `posledni_interakce` | timestamptz | the sort key |
| `kvalifikovat` | bool | the confirm row absorbed an unqualified call |
| `slouceno` | int | how many tasks were merged into this row |
| `vic_rezervaci`, `ceka_triage`, `zapomenuty` | bool | flags for the UI |

Companion functions, so clients never repeat these writes:
- `fn_fronta_zamkni(p_task bigint)` claims the 20-min lock and returns false if someone else holds it;
- the merge-and-close (3.2) and confirm self-healing (3.7) move into a trigger or a pg_cron job, so they run once on the server instead of in every browser.

What building it would take, under the repo rules: an `updates/` folder, a migration with a Czech `comment on`, a `BEGIN…ROLLBACK` validation, the Cockpit switched to the RPC, and a test proving the order matches today's. The golden hash would change.

---

## 6. Gotchas for a re-implementation

- `meeting_at` comes in two formats: GHL text such as `"October 21, 2026 3:00 PM"` (Prague time) and ISO. Parse both (`parseMeeting` in `19-Cockpit.js`).
- "Today", "before 9:00" and the 24 h windows are all in **Europe/Prague** time.
- `v_queue.is_due` is computed at query time, so re-fetch rather than caching it.
- The no-show and cancellation detection depends on the task **note** text (`Nedorazil`, `Zrušil`, `triage ✓`). This is brittle; option B is the place to replace it with real columns.
- The DB `ORDER BY` on `v_queue` and `tasks.priority` are **not** the visible order (see section 0).
