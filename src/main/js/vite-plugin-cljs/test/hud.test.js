import assert from 'node:assert/strict';
import { test } from 'node:test';
import { view } from '../hud.js';

const idle = { stopped: false, disconnected: false, compiling: null, reloading: null, loading: null };

test('the badge hides when nothing is happening', () => {
  assert.equal(view(idle), null);
});

test('the badge shows the most important status', () => {
  const all = { stopped: true, disconnected: true, compiling: 0, reloading: { done: 0, total: 1 }, loading: { done: 0, expected: 0 } };
  assert.deepEqual(view(all), { text: 'ClojureScript watch stopped', busy: false });
  assert.deepEqual(view({ ...all, stopped: false }), { text: 'Dev server disconnected', busy: false });
  assert.equal(view({ ...all, stopped: false, disconnected: false }).text, 'Compiling…');
  assert.equal(view({ ...idle, reloading: all.reloading, loading: all.loading }).text, 'Reloading 0/1');
});

test('compiles count seconds', () => {
  assert.deepEqual(view({ ...idle, compiling: 999 }), { text: 'Compiling…', busy: true });
  assert.equal(view({ ...idle, compiling: 3500 }).text, 'Compiling… 3s');
});

test('hot reloads count the modules applied', () => {
  assert.deepEqual(view({ ...idle, reloading: { done: 120, total: 340 } }), { text: 'Reloading 120/340', busy: true });
  assert.equal(view({ ...idle, reloading: { done: 341, total: 340 } }).text, 'Reloading 340/340');
});

test('loads count modules, with a percentage of the last load\'s', () => {
  assert.equal(view({ ...idle, loading: { done: 1234, expected: 0 } }).text, 'Loading modules… 1,234');
  assert.equal(view({ ...idle, loading: { done: 1545, expected: 3090 } }).text, 'Loading modules… 1,545 (50%)');
  assert.equal(view({ ...idle, loading: { done: 4000, expected: 3090 } }).text, 'Loading modules… 4,000 (99%)');
});
