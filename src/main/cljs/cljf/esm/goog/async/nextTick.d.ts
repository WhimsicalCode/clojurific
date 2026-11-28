// goog.async.nextTick, see nextTick.js.

/** Calls callback in a macrotask as soon as possible. */
export function nextTick<S = undefined>(callback: (this: S) => unknown, opt_context?: S, opt_useSetImmediate?: boolean): void;
