# Sections + templates — update v1 (CLOSED)

## Goal
A section rail on the left with two sections: **Tasks** (the existing feed,
unchanged) and **Templates**, a copy of the MenuBarTemplates app
(`~/dev/template-holder`): named templates with a subject, `{{ NAME }}`
placeholders, search, copy subject / body.

## Phases

### 1. Storage + resolver — done
- [x] `lib/templates.js`: `templates.json` in the app data folder (user data,
      outside the repo). First run imports MenuBarTemplates' templates (40).
- [x] API: `GET/POST /api/templates`, `PUT/DELETE /api/templates/:id`.
- [x] `public/resolve.js`: the placeholder rules (`{{ NAME }}`, include
      toggle, `{{gender:male|female}}`, HTML → plain text), shared by UI and tests.
- Tests: `test/templates.test.js` (detection, resolve, gender, plain text,
  import once, save, delete).

### 2. UI — done
- [x] Left rail (Tasks / Templates), ⌘1 / ⌘2, last section remembered;
      bottom bar under 700px. `/` focuses the current section's search and no
      longer fires while typing in a field.
- [x] Templates: searchable list (name, subject, body text), + / ⌘N new,
      editor with name, subject, Copy subject, Copy body (HTML + plain
      text), Preview, Fields panel (value + Include, gender), formatting
      toolbar (B, I, H2, lists, link), autosave, Duplicate, Delete with an
      inline confirm. ↑/↓ through the list, Enter to edit, Esc back.
- Verified in headless Chrome against the real server (temp data folder):
  import, search, fields, preview, copy contents, autosave, new, duplicate,
  delete, section switching, narrow layout.

## Next (not done)
- Use a template from a person's row in Tasks, with JMENO etc. filled in
  from the CRM.
