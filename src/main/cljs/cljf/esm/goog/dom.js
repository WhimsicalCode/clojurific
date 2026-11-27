// Copyright The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The subset of goog.dom used by ClojureScript libraries, as an ES module,
// from the Closure Library sources.

export function getWindow(opt_doc) {
  return opt_doc ? opt_doc.parentWindow || opt_doc.defaultView : window;
}

// The viewport's {width, height} (a goog.math.Size in Closure Library),
// without scrollbars
export function getViewportSize(opt_window) {
  const doc = (opt_window || window).document;
  const el = doc.compatMode == 'CSS1Compat' ? doc.documentElement : doc.body;
  return { width: el.clientWidth, height: el.clientHeight };
}
