import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtimeMessage } from '../runtime-ops.js';

test('runtimes send their own messages, not the plugin\'s', () => {
  for (const op of ['hello', 'focus', 'result', 'console-eval']) assert.ok(runtimeMessage({ op }), op);
  for (const op of ['dev-server', 'vite-error', 'vite-update', 'bye', 'eval', undefined]) assert.ok(!runtimeMessage({ op }), op);
  assert.ok(!runtimeMessage(null));
  assert.ok(!runtimeMessage('hello'));
});
