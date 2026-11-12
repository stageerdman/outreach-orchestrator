# CLAUDE.md — outreach-orchestrator

Compiled from the global AI Control modules (STRUCTURE, CODING, WORKFLOW, UX)
and tuned for this project. Regenerate with the `rebuild-claude-md` routine
when the global modules change. Local additions below the modules are
preserved across rebuilds.

Outreach Orchestrator is a small local web UI: the people to reach out to
(from a custom CRM), and per person their email (IMAP) and WhatsApp history
merged into one timeline. Plain Node HTTP server, no framework, no build step.

## Structure
- Keep the standard AI Control scaffold: `.project`, this `CLAUDE.md`,
  `.gitignore` (always covering `.env`), `.env` for secrets, `updates/`, and
  `issues.txt`.
- **Updates live in `updates/YYYY-MM-DD NAME - OPEN|CLOSED/`.** Each holds
  `update vX.md` (goal, phased roadmap, live status) and `wiki.md` (durable
  decisions and lessons). Reopen an update by flipping `CLOSED` → `OPEN`.
- **Stay flat.** `server.js` (routes), `lib/` (one file per data source:
  `crm.js`, `email.js`, `whatsapp.js`), `public/index.html` (the UI), `public/resolve.js` (template placeholders),
  `data/` (sample data), `macos/` (the native app wrapper, built with
  `npm run app`), `patches/` (changes to vendored code). Add folders only when the project genuinely grows
  into them; tests, when added, go in `test/` using Node's built-in
  `node --test`.

## Coding
- **Modular for isolated context:** each source in `lib/` exposes a small
  interface (`*Configured()` + a history/list function returning plain
  normalized objects). A new channel = a new `lib/<channel>.js` with the same
  shape, merged in `server.js` — no edits to the other sources.
- Every timeline message has the same shape:
  `{ channel, id, at (ISO string), fromMe, text, ... }`. Keep it that way so
  the merge-and-sort in `server.js` and the UI stay channel-agnostic.
- **Minimal:** build only what's needed. Prefer Node built-ins (`node:http`,
  `node:sqlite`, `fetch`, `node --test`) over new dependencies; no frameworks
  or layers on speculation.
- **Test what matters:** CRM field mapping/normalization (`get`, dot paths,
  string-or-list emails/phones), phone → WhatsApp JID matching, and email
  dedup. Skip tests for trivial glue.
- **Idiomatic Node ESM:** match the existing terse style; read the neighbors
  before writing.

## Workflow
- **Commit AND push after every change**, one focused logical unit per commit,
  with plain honest messages. Remote is
  `github.com/stageerdman/outreach-orchestrator` (private), branch `main`.
  Never commit secrets; `.env` stays gitignored.
- **Non-trivial work starts with a phased roadmap** in the update's
  `update vX.md`; track done / decided / next as you go. Most phases end with
  tests.
- **Research spikes** (e.g. a new CRM API, another messaging channel) run
  outside the main code, inside the update folder; capture findings in that
  update's `wiki.md`.
- **Act as an orchestrator:** decompose and delegate to focused agents rather
  than doing everything inline.
- **Verify by running the real thing** (`npm start` / `npm run dev`, then hit
  `/api/status`, `/api/people`, `/api/people/<id>/history` or open the UI),
  not just a green test.

## UX
- For UI work, **launch UX-expert agents** — several in parallel for distinct
  parts (people list, timeline, source status) — and synthesize.
- **Cut everything unnecessary:** a list on one side, a timeline on the
  other. Every new element must earn its place.
- **Minimal visual system:** one font, a small set of CSS variables for
  colors/spacing/sizes in `index.html` — no ad-hoc values.
- **Reusable, isolated pieces** even in a single HTML file: one render
  function per message type/component, defined once and reused.
- Accessible by default (contrast, keyboard navigation through the people
  list, focus states) with honest per-source error states — the server
  already returns `errors.email` / `errors.whatsapp`; surface them.

<!-- Local project rules below are preserved across CLAUDE.md rebuilds. -->
## Project-specific notes
- **`vendor/whatsapp-mcp` is external code** (a cloned third-party repo,
  gitignored, with its own `.git`). Don't edit it, except the user-approved
  bridge patch (2026-11-11), kept in `patches/whatsapp-bridge.patch`:
  whatsmeow bumped to latest (WhatsApp rejects the old client with "Client
  outdated (405)") plus a `POST /api/history` endpoint that asks the phone
  for older messages of one chat. After re-cloning or pulling upstream:
  `git -C vendor/whatsapp-mcp apply ../../patches/whatsapp-bridge.patch`,
  then `go build -o whatsapp-bridge .` in `whatsapp-bridge/`. The app only reads the
  bridge's SQLite DB, **read-only** — never write to it; the bridge writes
  to it while running.
- **Private data:** this app touches real emails and WhatsApp messages. Never
  commit message content, real CRM exports, or `messages.db`; only
  `data/people.sample.json` with fake people belongs in git.
- **Layout:** Messages and Tasks are a list (`--feed-w`) plus ONE shared chat
  column (`#chat`, moved between the two views; each list keeps its own
  selection). Selecting a row (click, or ↑/↓ with a 150 ms debounce) opens
  the whole conversation, newest at the bottom (last 50, "Show earlier"),
  with the composer under it. ≤900px: panes swap (`data-pane`, `.back`).
  A chat is marked read after 1 s open, visible and focused.
- **Refresh flow:** runs on server start and on demand. `lib/sync.js` pulls
  the CRM list, then each source's `<channel>Session(people)` (register new
  channels in `SOURCES`, fastest first); each source is published as soon as
  it's in, merged onto the current snapshot. `running` ends when the data is
  complete; the older-WhatsApp backfill runs after, in `state.backfill`.
  Live (`startLive()`): a WhatsApp DB watcher (`MAX(rowid)`, every second,
  read-only) and `emailWatch` (one long-lived IMAP connection, IPv4 first —
  the mail host's IPv6 hangs ~20 s —, IDLE on INBOX plus a STATUS check of
  all folders every 2 min) re-collect only the people involved. The snapshot
  holds every CRM contact.
- **Events:** `lib/events.js`, served as SSE at `GET /api/events`:
  `snapshot {at, stage}`, `messages {ids}`, `requests {id, personId, status}`.
- **Messages** (`lib/chats.js`, `/api/chats`): every CRM contact with
  messages; read state in `reads.json` (app data folder); unread = client
  messages after the later of last read and my last message.
- **Composer sends:** `POST /api/people/:id/send` records a request with
  `own: true` and goes through `ai.approve` (no playbook learning for these).
- **CRM is ResultsON** (Supabase/PostgREST), `lib/resultson.js`, `RESULTSON_*`
  keys, read-only (GET only, besides the login). Logs in as a team member
  (token reused while valid, 1 h), reads the needed tables whole, in parallel
  and paginated (1000 rows max per response), and returns every contact
  (except `nerelevantni` and pending deletions) as a person: task (the Fronta
  row's, else the soonest open one, else null; kind, rule, follow type, due,
  note), `phone_e164`, a pipeline stage (`stageOf`) and `queue`. The stage
  belongs to the person, not the current task. The user's pipeline, top
  first: Installment (any `splatka` task, open or closed, or a "Prodej na
  splátky" / "Upraveny platby" note; not once the contact is `paid` or a later
  lost note), Waiting for Payment ("Prodáno" or
  "Domluveno — čeká se na platbu" note, unless a later "Uzavřeno jako
  ztracené" note), Thinking about it (the consultation happened: follow-up
  `follow_typ=konzultace`, a "Neprodáno" / "Bez nabídky" / "Konzultace bez
  nabídky" note, a task closed "(show_offer)" / "(show_no_offer)", or call
  result `neprodej`), No Show (cancelled-consultation rule, a "Nedorazil"
  note or task note, a task closed "(no_show)"), then the furthest call
  result: Meeting Confirmed, Meeting Booked (also a "Domluvená schůzka" /
  "domluvenou schůzku" / "rezervoval si sám" note or task note), Answered, Not answered, New lead.
  Notes and all the contact's tasks (closed ones too) are read for these.
  "LTO nákup" (bought LTO) tasks are just new leads to the user: no special
  stage, they follow the same call-result rules.
- **Fronta** (`lib/fronta.js`, pure): ResultsON Cockpit's "Volat teď" main
  list replicated (rules in the CHAT update's `fronta-rules.md`): hide, merge
  per contact in memory only, group/score, who sees what (teammates' rows
  too, LEADY KOLEGŮ last), sort; Prague time throughout. `queue` = `{ group,
  score, color, order, meetingAt, due, qualify }` for rows in that list, else
  null. Shown with the user's names (`relabel`): To be booked, Thinking
  about it, Not answered, Installments; VRÁCÍ SE joins NOVÝ LEAD. Never lock, close merged tasks or self-heal.
- **UI feed (Tasks):** only people with a `queue` (Fronta's call-now list),
  in its order, grouped by `queue.group` with the Czech Fronta names (dot
  colour A/B/C: `--q-a`, `--q-b`, hollow); groups open except LEADY KOLEGŮ
  (in memory only). Non-ResultsON CRMs: `queue` undefined = in the feed,
  grouped by stage. People already messaged today (Prague day; history or a
  sent request) are hidden unless the client wrote back since. Rows show the
  draft status as text; drafting starts from ✨ in the chat or "Draft N".
- **Live UI:** one `EventSource('/api/events')` drives everything (no polling,
  except `/api/refresh` once a second while a refresh runs). The status line
  only shows what's off (failed/unconnected source, sample data, live
  updates down >30 s).
- **Composer:** Enter = newline, ⌘↩ = send, ⌘J (Alt+Enter) = ✨. No draft:
  the text is the message (or ✨'s instruction). A draft generating/waiting/
  failed: the text is a note for ✨ (regenerate), Send sends the gray draft
  bubble (editable in place). Channel toggle only with phone + email; on a
  waiting draft it switches the draft's channel without an AI run.
- **Local cache** (`lib/cache.js`, node:sqlite) lives in
  `~/Library/Application Support/Outreach/`, never in the repo: last
  snapshot, email headers/bodies per folder (`imapNext:<folder>` in kv),
  fully fetched WhatsApp chats and when each was last asked (`wa_asked`;
  re-asked after `WHATSAPP_BACKFILL_HOURS`, default 12, ≤5 pages per run).
- WhatsApp matching is by phone digits → `<digits>@s.whatsapp.net` plus the
  `<lid>@lid` chats mapped to that phone in the bridge's `whatsapp.db`
  (`whatsmeow_lid_map`, read-only). CRM phones must include the country code.
- **Sections:** a left rail switches views (Messages, Tasks, AI Requests,
  Templates, Playbooks, Settings; ⌘1–6, Messages is the default). Messages =
  every CRM contact with messages, newest first (`/api/chats`), unread pill,
  rail badge and `(n) Outreach` title = people with unread; rows keep their
  order while the pointer or focus is in the list. A new section
  = a link in `.rail`, a `#view-<name>` block, and its name in `SECTIONS`.
- **Templates** (`lib/templates.js`, `/api/templates`) live in
  `templates.json` in the app data folder (never the repo); the first run
  imported the MenuBarTemplates app's file (read-only). Placeholder rules are
  in `public/resolve.js`, shared by the UI and the tests.
- **Older WhatsApp history** is fetched only for CRM people's chats: after a
  refresh publishes, `whatsappBackfill` pages back via the bridge's
  `/api/history` (50 per request) until the phone has nothing older, then
  republishes. The app still never writes to the bridge's DBs.
- **AI requests** (`lib/assistant.js`): the arrow on a task row (or "Draft N"
  on a stage group) asks Claude Code headless (`lib/claude.js`: `claude -p`,
  no tools, JSON schema, the user's own login, max 2 at once) for the next
  step: a message (WhatsApp or email, templates first) or an "offer a meeting"
  request (Done = the user offered it, an activity, not a booking). Drafts wait in `requests.json` (app data folder) until the user
  sends (email over SMTP as a reply + Sent copy; WhatsApp opens the app
  prefilled and counts as sent), regenerates or cancels with an optional
  note. A person with a generating/pending draft can't get another. The AI
  sees the last 30 messages, its unsent drafts with the user's notes, and
  drafts sent since the last refresh. Every time it sees is Prague time
  (Europe/Prague), whatever the Mac's timezone. Each draft keeps the context the AI saw
  (stage, task, last 30 messages) and its task id, as training data with the
  user's decision. Cancelled drafts are listed with reason, message and that
  context; "Recover" makes a pending copy (`recoveredFrom`) only while the
  task still exists, nothing was sent since and no other draft is waiting. The CRM stays read-only.
  WhatsApp is offered only for numbers the bridge knows (`whatsappKnown`: a
  lid in `whatsmeow_lid_map` or a chat); otherwise email, or WhatsApp flagged
  "not found" when there's no email.
- **Playbooks** (`lib/playbooks.js`, `lib/coach.js`, `/api/playbooks`): a
  follow-up strategy per stage (plus a universal "no reply" one), ≤10 steps
  (channel, wait, ask, why, template variants), reply branches and lessons,
  in `playbooks.json` (app data folder). Drafts get the playbooks and the
  follow-up position (messages sent since the client last wrote) and record
  the step they followed. Building and learning run through the coach, one at
  a time: after every send / regenerate / cancel it returns operations on
  playbooks and templates, applied as one logged change; any change (also the
  user's own edits, merged per 10 min) can be undone if nothing changed it
  since. Method and data in the PLAYBOOKS update's `research-playbooks.md`.
  Learning is silent in the UI; only a failure shows (Playbooks + rail "!").
- **AI Requests UI:** Drafts tab = just the waiting cards (name, contact,
  message, actions; no AI reasoning, task row or due); History tab =
  cancelled and replaced drafts with reasons and context, plus sent ones.
  The same requests show in the chat (a draft keeps `channel`, `instruction`
  and `previousId`, the version it replaced, so the chat shows the notes and
  earlier versions); both stay in sync through SSE `requests`.
- **Style guide** (Settings → Learn my style): `lib/style.js` builds reply
  pairs, follow-ups and measured stats from the snapshot; one Claude run turns
  them into a Markdown guide (method in the AI REQUESTS update's
  `research-style.md`). Prompts, model and guide live in `settings.json`
  (app data folder); an empty prompt means the default in `lib/settings.js`.
