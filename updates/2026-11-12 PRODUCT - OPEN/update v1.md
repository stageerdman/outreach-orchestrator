# Product — update v1 (OPEN)

## Goal
Turn Outreach from "my app on my Mac" into something other people can buy,
install and set up on their own: macOS first (unsigned, no $99 Apple
Developer fee), Windows later. Setup is guided, partly by the AI (which CRM,
its credentials, email, WhatsApp QR), CRMs plug in as connectors, users can
report bugs that land in GitHub, and a licence (subscription or one-time)
unlocks the app.

## Where we are (assessed 2026-11-12)
The core works on real data, but it is built for one machine, one CRM and
one business:

| Area | Today | Sellable needs |
|---|---|---|
| Install | `Outreach.app` points at this repo folder and the system `node` (paths baked into Info.plist by `macos/build.sh`); the bridge is built by hand with Go | One self-contained `.app`: Node runtime, app code, `node_modules`, bridge binary inside the bundle (arm64 + x64) |
| Config | `.env` in the repo, edited by hand | Setup screens; settings in the app data folder; secrets in the macOS Keychain |
| CRM | ResultsON + Fronta hard-wired (`lib/resultson.js`, `lib/fronta.js`), plus a generic JSON endpoint (`lib/crm.js`, env field mapping) | A connector interface; ResultsON becomes one connector; generic CSV / Google Sheet / JSON; a couple of popular CRMs |
| Business logic | Six stages, Czech note phrases, Prague time, coaching-program prompts (`BUILD_PROMPT` etc. in `lib/settings.js`) | Stages, language, timezone and "what I sell" come from setup; prompts generic, filled from that |
| WhatsApp | Unofficial bridge (whatsmeow); QR pairing only in a terminal | QR shown in the app (bridge patch); clear risk notice (see wiki) |
| AI | Spawns the user's own `claude` CLI (`lib/claude.js`) | Decide the AI path first (see wiki: terms question); likely BYO Anthropic API key, Claude Code login as an option only if allowed |
| Bugs / updates | `issues.txt` | "Report a bug" in the app → GitHub issue; update check |
| Money | — | Licence keys via a merchant of record; landing page, privacy policy, terms |
| Windows | Core is portable Node + HTML; Mac-only bits: Swift wrapper, `open` for WhatsApp links, data dir path, MenuBarTemplates import, Keychain | Windows wrapper, installer, `%APPDATA%`, Credential Manager, bridge build for Windows |

**Rough distance:** a Mac beta strangers can install and set up ≈ **4–6
focused weeks** (phases 1–6). Windows ≈ **+1–2 weeks** after that, because
by then the Mac work has already made the core platform-neutral. The largest
single piece is phase 2 (un-hard-wiring the CRM and the business).

## What a user needs (target, after phase 1)
- A Mac with macOS 13+ (Apple Silicon or Intel). Nothing else to install: no
  Node, Go, Xcode or terminal.
- AI: an Anthropic API key (or, if allowed, Claude Code installed and logged
  in). Cost per draft is cents; we show a running estimate.
- Email: an IMAP/SMTP account with an app password (Gmail and iCloud need
  2-step verification on; see wiki for Outlook).
- WhatsApp: their phone, to scan a QR code once (Linked devices).
- A CRM with an API, or a CSV / Google Sheet export of their contacts.
- A licence key.

## Phases

### 0. Decisions (user) — before any code
- [ ] AI path: BYO API key only, or also the user's Claude Code login (check
      Anthropic's terms first, see wiki).
- [ ] WhatsApp: accept the unofficial-client risk with a clear warning, or
      make WhatsApp optional / experimental in the sold version.
- [ ] Price model (subscription vs. one-time + paid updates) and merchant of
      record (Lemon Squeezy / Paddle / Polar).
- [ ] Target buyer: other coaches/solo sales people like you (keep the
      playbook/stage idea, make it configurable) vs. anyone doing outreach.
- [ ] Name, and whether the repo stays private (bug reports go through a
      relay either way).

### 1. Self-contained Mac app (≈ 1 week)
- `macos/build.sh` bundles a Node runtime, the app, production
  `node_modules` and the bridge binary into `Contents/Resources`; no project
  path in Info.plist. Universal (arm64 + x64) or two downloads.
- Bridge built in CI for both architectures (CGO via go-sqlite3; fine on a
  Mac runner).
- Everything the app writes stays in `~/Library/Application Support/Outreach`
  (already true for the cache; move `.env` settings there, secrets to the
  Keychain via `security`).
- Ad-hoc signed (already), zipped, published as a GitHub Release (or the
  licence vendor's download).
- First launch with nothing configured opens Setup instead of sample data.
- Tests: a clean macOS user account installs from the zip and reaches Setup.

### 2. Connectors and a configurable business (≈ 1.5–2 weeks)
- `lib/crm/<name>.js` per connector, one shape:
  `{ id, label, fields /* setup form */, test(cfg), people(cfg) }` returning
  the existing person shape (`stage`, `task`, `queue` optional).
- Connectors: ResultsON (today's code + Fronta, unchanged behaviour), CSV /
  Google Sheet (published CSV URL), generic JSON REST (today's `crm.js`
  mapping, moved from env to settings), then 1–2 popular ones by demand
  (Pipedrive, HubSpot: both have token-based APIs).
- Stages become user data (name, order, colour, optional rules); without
  rules the stage is a CRM field or set by hand in the app. The six current
  categories and their Czech rules move into the ResultsON connector.
- "Your business" settings: what you sell, the goal of outreach, language,
  formal/informal address, timezone. The prompts in `lib/settings.js` and
  `lib/assistant.js` read these instead of the coaching/Czech/Prague text.
- Tests: each connector's normalisation; your data still produces the same
  stages and Fronta order (golden test on today's snapshot, kept local).

### 3. Guided setup, AI-assisted (≈ 1 week)
- A Setup section (also reachable later from Settings), steps with a live
  check each: AI → Email → WhatsApp → CRM → Your business → done.
  - Email: provider presets (Gmail, iCloud, Seznam, custom), test IMAP and
    SMTP, link to the provider's app-password page.
  - WhatsApp: bridge patch to expose the pairing QR (e.g. `GET /api/qr`),
    shown in the app; status turns green when linked.
  - CRM: pick a connector; its `fields` render the form; "Test" lists the
    first 5 people.
- The AI's role: a chat panel next to the steps that knows the step and its
  error. For "other CRM" the user pastes a sample API response, a CSV header
  or the CRM's API docs URL; the AI proposes the mapping (URL, auth header,
  list path, field paths, stage field) as a structured answer, the app tests
  it live and shows the result. The AI fills config; it never writes code at
  runtime.
- "Learn my style" and a first playbook build run at the end of setup.
- Tests: mapping proposals validated against the generic connector on the
  sample data.

### 4. Bug reports and updates (≈ 3–4 days)
- "Report a bug" (Help menu + Settings): description, optional screenshot,
  app version, macOS version, source status, last 200 log lines with emails,
  phones and message text redacted; the user sees exactly what's sent.
- Sent to a tiny relay (e.g. a Cloudflare Worker, free tier) that holds the
  GitHub token and creates an issue in this repo with a `user-report` label,
  rate-limited per licence key. No GitHub token ever ships in the app.
- Optional automatic error reports (opt-in): uncaught server errors,
  deduplicated by stack hash.
- Update check on start against a `latest.json` (GitHub Release); "Update"
  downloads the zip and replaces the app.
- Tests: redaction (no email/phone/message text survives).

### 5. Licensing and payments (≈ 3–5 days)
- Merchant of record handles checkout, EU VAT and invoices (you're in CZ; a
  MoR saves registering for VAT OSS yourself).
- Licence key entered in Setup, validated online with the vendor's API,
  cached; offline grace period (e.g. 7 days); one key = N Macs.
- Landing page with download, install steps (incl. the "Open Anyway"
  screenshots), privacy policy (all data stays on the Mac; only AI prompts
  go to Anthropic, bug reports only when sent) and terms.

### 6. Private beta (≈ 1–2 weeks elapsed)
- 3–5 users outside your setup (different CRM, Gmail, another language).
- Watch the bug-report flow; fix setup friction first.
- Exit: a beta user installs, sets up and sends a first draft without help.

### 7. Windows (≈ 1–2 weeks, after phase 6)
- Wrapper: a small Tauri or .NET WebView2 shell (the UI is already a web
  page), or Electron if size doesn't matter; it starts Node and the bridge
  like `macos/main.swift` does.
- Platform seams: data dir (`%APPDATA%\Outreach`), opening WhatsApp links
  (`start` instead of `open`), secrets (Credential Manager), MenuBarTemplates
  import (Mac only, skip).
- Bridge for Windows: CGO cross-compile (mingw) in CI, or a Windows runner.
- Installer (Inno Setup / MSIX unsigned); SmartScreen shows "Windows
  protected your PC → More info → Run anyway" until the app is signed.
- Tests: the full suite on a Windows CI runner; a clean Windows VM install.

## Status
- 2026-11-12: assessment and roadmap written. Next: phase 0 decisions.
