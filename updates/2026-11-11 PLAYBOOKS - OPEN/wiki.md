# PLAYBOOKS — wiki

- Changes are operations (setPlaybook replaces a whole playbook, setTemplate,
  deletePlaybook). Whole-playbook replacement is more robust with an LLM than
  fine-grained patches; validation (`cleanPlaybook`) drops unknown stages,
  channels and template ids and keeps ≤10 steps.
- Undo works on snapshots (before/after) and refuses when the item changed
  since, so undoing never silently drops a later change.
- The user's autosaves fold into one change per playbook within 10 minutes;
  editing back to the start removes the change.
- Templates written by the AI keep the id it gave them, so a step created in
  the same change can point at them.
- Follow-up position = touches since the client last wrote (messages of mine
  within 6 h are one touch); the same definition is used for the reply-rate
  stats, where a reply credits only my last touch before it.
- Data (see research-playbooks.md): cold leads stop replying after 2–3
  touches; WhatsApp ≫ email; 2–4 day gaps; short messages with a question.
- Headless Chrome: navigating to the same URL with a hash doesn't reload the
  page; use Page.reload when checking CSS changes.
