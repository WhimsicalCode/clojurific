// Copyright The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// goog.async.nextTick as an ES module, from the Closure Library sources.

function getNextTickImpl() {
  if (typeof MessageChannel !== 'undefined') {
    const channel = new MessageChannel();
    let head = {};
    let tail = head;
    channel.port1.onmessage = () => {
      if (head.next !== undefined) {
        head = head.next;
        const cb = head.cb;
        head.cb = null;
        cb();
      }
    };
    return (cb) => {
      tail.next = { cb };
      tail = tail.next;
      channel.port2.postMessage(0);
    };
  }
  return (cb) => setTimeout(cb, 0);
}

// Runs callback in a macrotask as soon as possible: setImmediate outside of
// browsers (Node.js), a MessageChannel's message in them
export function nextTick(callback, opt_context, opt_useSetImmediate) {
  const cb = opt_context ? callback.bind(opt_context) : callback;
  if (typeof globalThis.setImmediate === 'function' &&
      (opt_useSetImmediate || !globalThis.Window || !globalThis.Window.prototype ||
       globalThis.Window.prototype.setImmediate != globalThis.setImmediate)) {
    globalThis.setImmediate(cb);
    return;
  }
  // nextTick.setImmediate_ as Closure Library's, which tests may replace
  if (!nextTick.setImmediate_) nextTick.setImmediate_ = getNextTickImpl();
  nextTick.setImmediate_(cb);
}
