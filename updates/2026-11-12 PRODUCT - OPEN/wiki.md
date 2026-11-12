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

## AI: whose Claude account? (open, blocking decision)
- Today `lib/claude.js` runs the user's own `claude` CLI with their own login
  (subscription). For a product that's simple (no keys, no billing on our
  side) but Anthropic's docs for the Agent SDK said third-party developers
  may not offer claude.ai login / subscription limits in their products
  without approval. **verify** the current wording before shipping this path.
- Clean path: the user pastes an Anthropic API key in Setup; the app calls
  the Messages API directly with `fetch` (structured output via tool use /
  JSON schema), which also removes the Claude Code install requirement and
  works the same on Windows. `askClaude()` is the only seam to change.
- Keep the CLI path as an option if allowed (power users with Claude Code).

## WhatsApp risk
- The bridge is whatsapp-mcp (MIT) on whatsmeow (MPL-2.0; we ship it
  unmodified, only bumped, so MPL obligations are light: credit and point to
  its source). Licences are fine for a paid app.
- whatsmeow is an unofficial client: it is against WhatsApp's terms and
  accounts can be banned, more likely with high volume. The app only reads
  and opens WhatsApp prefilled (the user sends by hand), which keeps the
  footprint low, but buyers must be told plainly. Selling it raises the
  stakes compared to personal use.
- The official alternative (WhatsApp Business Platform / Cloud API) can't
  read a personal number's history and needs approved templates outside the
  24 h window, so it doesn't fit this app's "your existing chats" idea.
- Pairing QR: the bridge prints it to the terminal today; the app needs it
  in the UI (a small addition to `patches/whatsapp-bridge.patch`, needs the
  user's approval like the first patch).

## Email providers
- Gmail and iCloud: IMAP + app password, needs 2-step verification.
- Microsoft (Outlook.com / Microsoft 365) has been turning off password
  (basic) auth for IMAP/SMTP in favour of OAuth. **verify**; supporting them
  may need an OAuth flow, so start with Gmail / iCloud / custom IMAP.

## Bug reports into GitHub
- The repo is private, so buyers can't open issues there, and a GitHub
  token must never ship inside the app. A relay (Cloudflare Worker or
  similar, holding a fine-grained token with Issues: write on this repo
  only) turns an in-app report into an issue. Rate-limit per licence key.
- Privacy: this app holds client emails and WhatsApp messages. Reports carry
  versions, source status and redacted logs only; the user previews the
  report before sending. Never attach `messages.db`, snapshots or chats.

## Payments
- A merchant of record (Lemon Squeezy, Paddle, Polar) sells, handles EU VAT
  and invoices, and issues licence keys with a validation API. Subscription
  or one-time are both supported; the app side (enter key, validate, cache,
  grace period) is the same either way.

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
