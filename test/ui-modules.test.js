import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A module index.html imports but the server doesn't serve stops the whole UI.
test('every module index.html imports is served by server.js', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const shared = server.match(/const SHARED = \[([^\]]*)\]/)?.[1] ?? '';
  for (const [, path] of html.matchAll(/from '(\/[^']+\.js)'/g)) assert.ok(shared.includes(`'${path}'`), `${path} is imported but not served`);
});
