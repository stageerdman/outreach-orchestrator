# Sections + templates — wiki

- UX review (two agents): use a `<nav>` rail with `aria-current`, not a
  tablist (the arrow keys already move through the people list). Each section
  keeps its own header and search. Delete asks inline, because
  `window.confirm` doesn't work in WKWebView without a UI delegate. For the
  same reason the link button uses an inline URL field, not `prompt()`.
- Placeholder values stay in memory and carry over between templates, as in
  the native app: fill JMENO once and it's used everywhere. They are never
  saved.
- Placeholder names may use Czech capitals (`\p{Lu}`), and `&nbsp;` from the
  rich editor is accepted inside the braces. Values put into the HTML body
  are escaped.
- Copy runs a `copy` event inside the click, setting `text/html` and
  `text/plain`. WebKit allows this. `navigator.clipboard.write` is the
  fallback.
- MenuBarTemplates' `templates.json` is only read, once, when Outreach has
  no templates file yet. After that the two apps are separate.
