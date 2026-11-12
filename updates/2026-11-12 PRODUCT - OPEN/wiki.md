# Product — wiki

Findings and open questions for selling the app. Items marked **verify** are
from memory (2026-11-12) and must be checked against the current source
before acting on them.

## Distribution without the Apple Developer Program
- The app is already ad-hoc signed (`codesign --sign -`), which Apple Silicon
  requires for any native binary. Not notarized, so a browser-downloaded zip
  is quarantined and Gatekeeper blocks the first open.
- Since macOS 15 the Control-click → Open bypass is gone; the user goes to
  System Settings → Privacy & Security → "Open Anyway" once. **verify** on
  the current macOS. Install docs need screenshots of this.
- Files fetched with `curl` don't get the quarantine flag, so a one-line
  installer (`curl … | sh` that downloads and unzips into ~/Applications)
  skips the prompt. Less friendly for non-technical buyers, but an option.
- Homebrew casks: Homebrew has been phasing out casks that fail Gatekeeper.
  **verify**; probably not a route for an unsigned app.
- The bundled bridge and Node binaries must be ad-hoc signed too (inside the
  bundle, before signing the app).
- If sales take off, the $99/year buys notarization and removes all of this;
  worth it once there are paying users.

## AI: the user's own CLI (decided 2026-11-12)
- The user connects whatever AI they already pay for through its CLI;
  nothing is billed by us and no API keys are handled. One adapter per CLI
  in `lib/ai.js` (today's `lib/claude.js` is the Claude Code adapter):
  - Claude Code: `claude -p --output-format json --json-schema …` (works).
  - Codex: `codex exec` with a JSON output schema option. **verify** flags
    and how it reports "not logged in".
  - Gemini CLI: `gemini -p` with JSON output. **verify**.
- Each adapter: detect (on PATH / known install dirs, since apps from
  Finder get a minimal PATH), check login, run a prompt → JSON matching the
  schema (validate it; retry once if a CLI ignores the schema).
- Prompts were tuned on Claude; check draft quality per CLI in the beta.
- Open point to **verify**: Anthropic's (and OpenAI's) terms on third-party
  apps driving a subscription CLI. The app only runs the user's own
  installed CLI under their own login, locally, which is the least risky
  shape; re-check before launch.

## WhatsApp risk
- The bridge is whatsapp-mcp (MIT) on whatsmeow (MPL-2.0; we ship it
  unmodified, only bumped, so MPL obligations are light: credit and point to
  its source). Licences are fine for a paid app.
- whatsmeow is an unofficial client: it is against WhatsApp's terms and
  accounts can be banned. Decided (2026-11-12): say so in the README only,
  not in the app. Mitigation: the app only reads chats and opens WhatsApp
  prefilled, so the user sends every message themselves.
- Opt-in "send from the app" (through the bridge's send endpoint) for users
  who ask for it; the README says the ban risk is higher then.
- The official alternative (WhatsApp Business Platform / Cloud API) can't
  read a personal number's history and needs approved templates outside the
  24 h window, so it doesn't fit this app's "your existing chats" idea.
- Pairing QR: the bridge prints it to the terminal today; the app needs it
  in the UI (a small addition to `patches/whatsapp-bridge.patch`, needs the
  user's approval like the first patch).

## Email providers
- Gmail and iCloud: IMAP + app password, needs 2-step verification.
- Microsoft (Outlook.com / Microsoft 365): password (basic) auth for
  IMAP/SMTP is being turned off, so "Sign in with Microsoft" (decided
  2026-11-12) through the user's Azure app registration: multi-tenant +
  personal accounts, public client (desktop) with PKCE and a localhost
  redirect, scopes `IMAP.AccessAsUser.All`, `SMTP.Send`, `offline_access`.
  imapflow and nodemailer take the access token (XOAUTH2). Microsoft 365
  tenants may need an admin to allow the app or SMTP AUTH. **verify**
  current scope names.
- Gmail OAuth is a different story: mail scopes are "restricted" and need
  Google's verification plus a paid security assessment, so Gmail stays on
  app passwords.

## Bug reports into GitHub
- The repo is private, so buyers can't open issues there, and a GitHub
  token must never ship inside the app. A relay (Cloudflare Worker or
  similar, holding a fine-grained token with Issues: write on this repo
  only) turns an in-app report into an issue. Rate-limit per licence key.
- Privacy: this app holds client emails and WhatsApp messages. Reports carry
  versions, source status and redacted logs only; the user previews the
  report before sending. Never attach `messages.db`, snapshots or chats.

## Payments and licence (decided 2026-11-12)
- 7-day free trial, then 3 000 CZK one-time or 200 CZK/month. 15 months of
  subscription = the one-time price.
- A merchant of record (Lemon Squeezy, Paddle, Polar) sells, handles EU VAT,
  invoices, the subscription and the customer portal (cancel, change card).
  Check per vendor: CZK pricing, licence keys built in, webhooks for
  cancelled / failed / refunded, fees.
- "Kill the licence" = our licence server (a small Worker) marks it
  inactive from the vendor's webhook; the app sees it at the next daily
  check, or when the 7-day offline cache runs out. Nothing on the user's
  Mac is deleted; the app just shows "Buy or renew". An unsigned app can be
  patched by a determined user; acceptable at this price.

## Time-saved marketing
- Use real numbers from the user's own data before claiming anything; label
  typing time as an estimate. The in-app card and the landing calculator
  share one formula.

## Making it generic: what's specific to the user today
- `lib/resultson.js`: the six categories and their Czech note phrases,
  `LEGACY` names, Fronta categories.
- `lib/fronta.js`: ResultsON Cockpit rules, Prague time.
- `lib/settings.js` / `lib/assistant.js`: prompts describe a Czech men's
  coaching program, the consultation goal, "usually Czech", Prague time.
- `lib/templates.js`: imports from the MenuBarTemplates app (Mac, the user's
  own app).
- `macos/build.sh`: project path and system node baked into Info.plist.
These become connector code (ResultsON) or "Your business" settings.
