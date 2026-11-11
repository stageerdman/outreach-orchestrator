# Adopt — wiki

- Each data source in `lib/` returns the same message shape
  (`channel, id, at, fromMe, text`), so `server.js` just concatenates and sorts
  by `at`. Keep new channels to that contract.
- The WhatsApp source depends on the external whatsapp-mcp bridge's SQLite
  DB, opened read-only. Vendor code stays gitignored and unedited.
- Secrets vs config: only credentials go into `.project` `secrets:`; endpoint
  URLs, hosts and field mappings are per-project config in `.env.example`.
