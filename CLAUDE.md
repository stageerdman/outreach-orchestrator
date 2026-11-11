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
  `crm.js`, `email.js`, `whatsapp.js`), `public/index.html` (the UI),
  `data/` (sample data). Add folders only when the project genuinely grows
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
  gitignored, with its own `.git`). Don't edit it. The app only reads the
  bridge's SQLite DB, **read-only** — never write to it; the bridge writes
  to it while running.
- **Private data:** this app touches real emails and WhatsApp messages. Never
  commit message content, real CRM exports, or `messages.db`; only
  `data/people.sample.json` with fake people belongs in git.
- **Layout:** one people list; clicking a person expands their timeline in
  place (asked for by the user, replaces "list on one side, timeline on the
  other" from the UX module).
- **Refresh flow:** `lib/sync.js` pulls the CRM list, then each person's
  history through each source's `<channel>Session()` into an in-memory
  snapshot that the API serves. Register new channels in its `SOURCES`.
- WhatsApp matching is by phone digits → `<digits>@s.whatsapp.net`, so CRM
  phones must include the country code.
