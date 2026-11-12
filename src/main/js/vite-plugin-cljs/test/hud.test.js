import assert from 'node:assert/strict';
import { test } from 'node:test';
import { view } from '../hud.js';

const idle = { stopped: false, disconnected: false, compiling: null, reloading: null, loading: null };

test('the badge hides when nothing is happening', () => {
  assert.equal(view(idle), null);
});

test('the badge shows the most important status', () => {
  const all = { stopped: true, disconnected: true, compiling: 0, reloading: { done: 0, total: 1 }, loading: { done: 0, expected: 0 } };
  assert.equal(view(all), 'ClojureScript watch stopped');
  assert.equal(view({ ...all, stopped: false }), 'Dev server disconnected');
  assert.equal(view({ ...all, stopped: false, disconnected: false }), 'Compiling…');
  assert.equal(view({ ...idle, reloading: all.reloading, loading: all.loading }), 'Reloading 0/1');
});

test('compiles count seconds', () => {
  assert.equal(view({ ...idle, compiling: 999 }), 'Compiling…');
  assert.equal(view({ ...idle, compiling: 3500 }), 'Compiling… 3s');
});

test('hot reloads count the modules applied', () => {
  assert.equal(view({ ...idle, reloading: { done: 120, total: 340 } }), 'Reloading 120/340');
  assert.equal(view({ ...idle, reloading: { done: 341, total: 340 } }), 'Reloading 340/340');
});

test('loads count modules, with a percentage of the last load\'s', () => {
  assert.equal(view({ ...idle, loading: { done: 1234, expected: 0 } }), 'Loading modules… 1,234');
  assert.equal(view({ ...idle, loading: { done: 1545, expected: 3090 } }), 'Loading modules… 1,545 (50%)');
  assert.equal(view({ ...idle, loading: { done: 4000, expected: 3090 } }), 'Loading modules… 4,000 (99%)');
});
