// The REPL's TypeScript completions (ts-completions.js) off the dev server's
// thread: the language service is synchronous, starting it (1-3s) and
// completing would hold up Vite's serving, hot updates and websocket, through
// which the runtime's completions (clj-suitable) reach the page. Requests
// {id, root, tsconfig, code, position, prefix, details, deadline} are answered
// with {id, ...result}; one whose deadline passed while the service started,
// or behind other requests, isn't completed, its asker gave up: {id, skipped}.
import { parentPort } from 'node:worker_threads';
import { tsCompletions } from './ts-completions.js';

let complete;

parentPort.on('message', ({ id, root, tsconfig, deadline, ...request }) => {
  // the first request starts the service, whatever its deadline (the REPL's
  // warm-up has none left)
  const started = complete !== undefined;
  complete ??= tsCompletions({ root, tsconfig });
  if (started && deadline && Date.now() > deadline) {
    parentPort.postMessage({ id, skipped: true });
    return;
  }
  let result;
  try {
    result = complete(request);
  } catch (e) {
    result = { error: String(e?.message ?? e) };
  }
  parentPort.postMessage({ id, ...result });
});
