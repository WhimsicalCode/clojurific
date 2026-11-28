// The subset of goog.dom in dom.js.

/** opt_doc's window, or the current one. */
export function getWindow(opt_doc?: Document): Window;
/** The viewport's size, without scrollbars. */
export function getViewportSize(opt_window?: Window): { width: number; height: number };
