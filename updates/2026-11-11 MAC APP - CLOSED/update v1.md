# Mac app — update v1 (CLOSED)

## Goal
Open Outreach as a normal Mac app instead of a browser tab.

## Phases
1. **Wrapper** (done) — `macos/main.swift`: a native window (WKWebView)
   around the local UI. Starts the WhatsApp bridge and the Node server unless
   they already answer, stops only what it started on quit. Edit menu
   (copy/paste), Cmd+R reload, window size remembered, outside links open in
   the browser. Logs in `~/Library/Logs/Outreach/`.
2. **Build** (done) — `npm run app` (`macos/build.sh`): swiftc, generated
   icon, Info.plist with this checkout's path and node, ad-hoc signed,
   installed to `~/Applications/Outreach.app` (~830 KB).
3. **Verify** (done) — opened from Finder with nothing running: both
   services started as children, bridge reconnected, the window ran a
   refresh. Quit stopped both cleanly; reopened fine. User confirmed.

## Decisions
- Swift + WKWebView, not Electron (~200 MB) or Tauri (needs a Node sidecar
  anyway): tiny, no new dependencies, same UI code.
- No Tailwind: it would add a build step or CDN; the UI's small CSS-variable
  system already covers it.
- The app points at this checkout (path baked in at build time); rebuild
  after moving the folder.
