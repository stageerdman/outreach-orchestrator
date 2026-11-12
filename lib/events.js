// App-wide events for the UI's live stream (GET /api/events):
// 'snapshot' (a refresh published), 'messages' { ids } (new messages for these
// people), 'requests' { id, personId, status } (an AI request changed),
// 'personal' {} (the user's rules or the AI's questions changed).
import { EventEmitter } from 'node:events';

export const events = new EventEmitter();
events.setMaxListeners(0); // one listener per open browser tab
