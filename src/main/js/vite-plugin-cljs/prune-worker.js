// Parses chunks and summarizes their statements for pruning (prune.js) off the
// main thread: turning the parser's AST into JavaScript objects is most of
// pruning's time, the summaries are small.
import { parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { summarize } from './prune.js';

let oxc;

parentPort.on('message', async ({ id, oxcPath, fileName, code }) => {
  try {
    oxc ??= await import(pathToFileURL(oxcPath).href);
    const result = oxc.parseSync(fileName, code, { sourceType: 'module', lang: 'js' });
    if (result.errors?.length) throw new Error(`parsing ${fileName}: ${result.errors[0].message}`);
    parentPort.postMessage({ id, summary: summarize(code, result.program) });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
