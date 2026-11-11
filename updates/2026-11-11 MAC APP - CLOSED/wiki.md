# Mac app — wiki

- The bridge waits for SIGINT/SIGTERM (no stdin loop), so it runs fine as a
  child process with stdin closed; Process.terminate() shuts it down cleanly.
- Apps launched from Finder get a minimal PATH; the wrapper sets one and uses
  node's absolute path from Info.plist.
- If WhatsApp ever logs out, the bridge needs a QR scan: quit the app and run
  `./whatsapp-bridge` in `vendor/whatsapp-mcp/whatsapp-bridge` once in a
  terminal.
