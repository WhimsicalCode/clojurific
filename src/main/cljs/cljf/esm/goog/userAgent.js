// Copyright The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The subset of goog.userAgent used by ClojureScript libraries (cljs-http),
// as an ES module.

export function getUserAgentString() {
  const navigator = globalThis.navigator;
  return (navigator && navigator.userAgent) || '';
}
