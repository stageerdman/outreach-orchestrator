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
| WhatsApp | Unofficial bridge (whatsmeow); QR pairing only in a terminal | QR shown in the app (bridge patch); risk explained in the README only; optional "send from the app" |
| Email | IMAP/SMTP with an app password | Gmail, iCloud (app passwords) and Microsoft sign-in (OAuth, the user's Azure app) |
| AI | Spawns the user's own `claude` CLI (`lib/claude.js`) | The user's own AI CLI, whichever they subscribe to: Claude Code, Codex, Gemini CLI…; an adapter per CLI and a simple guided install + login |
| Bugs / updates | `issues.txt` | "Report a bug" in the app → GitHub issue; update check |
| Money | — | 7-day trial, then 3 000 CZK once or 200 CZK/month, via a merchant of record; the licence stops working when a subscription ends; landing page, privacy policy, terms |
| Marketing | — | "Time saved" numbers in the app and a calculator on the landing page |
| Windows | Core is portable Node + HTML; Mac-only bits: Swift wrapper, `open` for WhatsApp links, data dir path, MenuBarTemplates import, Keychain | Windows wrapper, installer, `%APPDATA%`, Credential Manager, bridge build for Windows |

**Rough distance:** a Mac beta strangers can install and set up ≈ **5–7
focused weeks** (phases 1–6, now including Microsoft sign-in, several AI
CLIs and the time-saved work). Windows ≈ **+1–2 weeks** after that, because
by then the Mac work has already made the core platform-neutral. The largest
single piece is phase 2 (un-hard-wiring the CRM and the business).

## What a user needs (target, after phase 1)
- A Mac with macOS 13+ (Apple Silicon or Intel). Nothing else to install: no
  Node, Go, Xcode or terminal.
- AI: a subscription to an AI with a command-line tool (Claude Pro/Max →
  Claude Code, ChatGPT Plus/Pro → Codex, Google → Gemini CLI). Setup walks
  them through installing it and logging in; no API keys, nothing billed by us.
- Email: Gmail or iCloud (app password, needs 2-step verification), a
  Microsoft account (sign in with Microsoft), or any IMAP/SMTP account.
- WhatsApp: their phone, to scan a QR code once (Linked devices).
- A CRM with an API, or a CSV / Google Sheet export of their contacts.
- Nothing to start the trial; a purchase after 7 days.

## Phases

### 0. Decisions
Decided (user, 2026-11-12):
- [x] AI: the user connects their own AI through its CLI, whichever they
      subscribe to (Claude Code, Codex, others). We give very simple
      guidance to install it and log in.
- [x] WhatsApp risk is explained in the README, not in the app: it's an
      unofficial client, mitigated because the user sends every message
      themselves in WhatsApp. On request, an opt-in "send from the app" (the
      README says the ban risk is higher then).
- [x] Email: Gmail, iCloud and Microsoft sign-in (the user has Azure for the
      app registration), plus custom IMAP.
- [x] Price: 7-day free trial, then 3 000 CZK one-time or 200 CZK/month. A
      licence that isn't paid (subscription cancelled or payment failed)
      stops working after a short grace period.
- [x] Marketing: show how much time and work the app saves, and whether
      that's worth it at the user's hourly rate.

Still open:
- [ ] Merchant of record (Lemon Squeezy / Paddle / Polar): compare CZK
      pricing, trials, fees.
- [ ] Target buyer: other coaches/solo sales people like you (keep the
      playbook/stage idea, make it configurable) vs. anyone doing outreach.
- [ ] Name, and whether the repo stays private (bug reports go through a
      relay either way).
- [ ] What "one-time" includes: updates forever, or a year of updates.

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

### 3. Guided setup, AI-assisted (≈ 1.5 weeks)
- A Setup section (also reachable later from Settings), steps with a live
  check each: AI → Email → WhatsApp → CRM → Your business → done.
  - AI: "Which AI do you pay for?" (Claude, ChatGPT, Gemini, other). The app
    detects whether the CLI is installed and logged in; if not, 2–3 steps
    with copy buttons (install command, "log in" opens a Terminal running
    the CLI's login, "Check again"). A test prompt confirms it works.
    `lib/claude.js` becomes `lib/ai.js` with one adapter per CLI (how to
    call it, how to get structured JSON back, how to check the login);
    `askClaude()` callers don't change. Claude Code and Codex first.
  - Email: provider presets with a live IMAP + SMTP test:
    - Gmail and iCloud: app password, with a link to the provider's
      app-password page and a one-line "turn on 2-step verification first".
    - Microsoft (Outlook.com, Microsoft 365): "Sign in with Microsoft",
      OAuth 2.0 with PKCE through the user's Azure app registration, XOAUTH2
      for IMAP and SMTP (imapflow and nodemailer support it), refresh token
      in the Keychain.
    - Other: host, port, user, password.
  - WhatsApp: bridge patch to expose the pairing QR (e.g. `GET /api/qr`),
    shown in the app; status turns green when linked.
  - WhatsApp sending (Settings, off by default): send through the bridge
    instead of opening WhatsApp. Opt-in, explained in the README.
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

### 5. Trial, licensing and payments (≈ 1 week)
- Offer: 7-day free trial (no card), then **3 000 CZK one-time** or **200
  CZK/month** (cancel anytime). Prices incl. or excl. VAT: decide with the
  merchant of record.
- The merchant of record handles checkout, EU VAT and invoices (you're in
  CZ; it saves registering for VAT OSS yourself), the subscription billing,
  and a customer portal where the buyer cancels or changes the card.
- Trial: starts on first launch, registered with our licence server against
  a machine id, so reinstalling doesn't restart it. The app shows "N days
  left" and a Buy button (both options) from day 5.
- Licence check: on start and once a day the app asks the licence server
  (the same small Worker as the bug relay, fed by the vendor's webhooks:
  paid, renewed, cancelled, payment failed, refunded). Answer cached, signed.
  - One-time: active forever.
  - Subscription: active while paid; cancelled = works until the end of the
    paid month; payment failed = 7 days grace with a "fix payment" notice,
    then the licence is killed.
  - Offline: works up to 7 days since the last successful check.
  - Killed / expired: the app opens to a "Buy or renew" screen; local data
    stays untouched (it's the user's), nothing is deleted.
- One licence = up to 2 Macs; deactivate a Mac from Settings.
- Tests: licence state machine (trial, active, cancelled, grace, killed,
  offline), webhook handling.
- Landing page with the time-saved calculator (phase 5b), download,
  install steps (incl. the "Open Anyway" screenshots), privacy policy (all
  data stays on the Mac; prompts go only to the user's own AI; bug reports
  only when sent) and terms.

### 5b. Show the time it saves (≈ 3–4 days)
- Measure honestly first, on your own use: from `requests.json` /
  `lessons.json` and the snapshot we already have drafts generated, sent
  as-is vs. edited, time from draft to send, follow-ups the playbooks
  scheduled, messages per day. Typing time is estimated (characters ÷ a
  typing speed, plus looking up the conversation), clearly labelled as an
  estimate.
- In the app (Settings or a small "This month" card): messages handled,
  follow-ups sent on time, hours saved, worth N CZK at your hourly rate
  (asked once, editable) vs. the 200 CZK/month. Shown during the trial too,
  so the decision on day 7 is based on their own numbers.
- Landing page: an interactive calculator (leads per week, messages per
  lead, minutes per message, hourly rate → hours and CZK saved per month,
  payback time for 3 000 CZK), seeded with your measured numbers, plus a
  before/after chart of a typical day.
- Tests: the stats calculation on fixed sample data.

### 6. Private beta (≈ 1–2 weeks elapsed)
- 3–5 users outside your setup (different CRM, Gmail, another language).
- Watch the bug-report flow; fix setup friction first.
- Exit: a beta user installs, sets up and sends a first draft without help.

### 7. Windows (≈ 1–2 weeks, after phase 6)
- Wrapper: a small Tauri or .NET WebView2 shell (the UI is already a web
  page), or Electron if size doesn't matter; it starts Node and the bridge
  like `macos/main.swift` does.
- AI CLIs on Windows: Claude Code and Codex both run there; the adapters
  find the `.cmd` shims on PATH.
- Platform seams: data dir (`%APPDATA%\Outreach`), opening WhatsApp links
  (`start` instead of `open`), secrets (Credential Manager), MenuBarTemplates
  import (Mac only, skip).
- Bridge for Windows: CGO cross-compile (mingw) in CI, or a Windows runner.
- Installer (Inno Setup / MSIX unsigned); SmartScreen shows "Windows
  protected your PC → More info → Run anyway" until the app is signed.
- Tests: the full suite on a Windows CI runner; a clean Windows VM install.

## Status
- 2026-11-12: assessment and roadmap written.
- 2026-11-12: user decided AI (own CLI), WhatsApp (README note, opt-in
  sending), email (Gmail, iCloud, Microsoft sign-in), price (7-day trial,
  3 000 CZK once / 200 CZK a month, licence killed when unpaid) and the
  time-saved marketing. Next: the remaining phase 0 questions, then phase 1.
