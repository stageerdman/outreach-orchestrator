# Outreach

A simple local UI: the list of people to reach out to (from your CRM), and for each person
their full email (IMAP) and WhatsApp history in one timeline.

## Run

```sh
cp .env.example .env   # fill in CRM + IMAP settings
npm start              # http://localhost:3000
```

Without any settings it runs on `data/people.sample.json`. Opening the page (or pressing
**Refresh**) pulls the people from the CRM and everyone's email and WhatsApp history; click
a person to expand their merged history. The status line under the search shows which
sources are connected, off, or failing. History is kept in memory only, so after a restart
the first page load refreshes again.

## Sources

**CRM**: `CRM_URL` must return a JSON list of people. Map your field names with
`CRM_ID_FIELD`, `CRM_NAME_FIELD`, `CRM_EMAIL_FIELD`, `CRM_PHONE_FIELD` (dot paths work,
e.g. `contact.email`). If the list is nested, set `CRM_LIST_PATH`. Code: `lib/crm.js`.

**Email**: any IMAP server. Searches the Inbox and Sent folders for mail from/to/cc the
person's addresses. Use an app password. Code: `lib/email.js`.

**WhatsApp**: reads the [whatsapp-mcp](https://github.com/lharries/whatsapp-mcp) bridge's
SQLite DB (`vendor/whatsapp-mcp/whatsapp-bridge/store/messages.db`), read-only. Matching
is by phone number, so CRM phones need the country code (`+63…`). Code: `lib/whatsapp.js`.

Start the bridge (first run shows a QR code: WhatsApp on phone → Linked devices → Link a device):

```sh
cd vendor/whatsapp-mcp/whatsapp-bridge && ./whatsapp-bridge
```

Keep it running so new messages keep syncing. It stores only the history WhatsApp sends
it at link time plus everything after.
