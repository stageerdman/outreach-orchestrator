# Adopt — update v1 (CLOSED)

## Goal
Bring the existing outreach-orchestrator folder under AI Control as a project,
without changing any app code.

## Starting state
- Working Node app (`server.js`, `lib/crm.js`, `lib/email.js`,
  `lib/whatsapp.js`, `public/index.html`, sample data), README and
  `.env.example`.
- Git initialized on `master` with no commits and no remote.
- `vendor/whatsapp-mcp` cloned in as an external, gitignored dependency.

## Phases
1. **Classify** (done) — a project, not an organizer: one app, no child
   project folders.
2. **Scaffold** (done) — added `.project`, `CLAUDE.md` (from WORKFLOW,
   STRUCTURE, CODING, UX), `issues.txt`, `updates/`. `.gitignore` already
   covered `.env`, `node_modules/` and `vendor/`.
3. **Backup** (done) — renamed branch to `main`, first commit, created private
   GitHub repo `stageerdman/outreach-orchestrator`, pushed.

## Decisions
- Secrets listed in `.project`: only `CRM_TOKEN` and `IMAP_PASS`. Other
  `.env` keys are per-project config, documented in `.env.example`.
- No local `.env` created: the global `~/.ai-control/.env` has no matching
  keys yet; copy `.env.example` and fill in when connecting real sources.
- Repo is private: the app handles real CRM, email and WhatsApp data.

## Next
See `issues.txt` (tests first).
