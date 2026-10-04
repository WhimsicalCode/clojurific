// The subset of goog.userAgent.product used by ClojureScript (cljs.spec.test
// stack trace parsing), as an ES module.

const ua = (globalThis.navigator && globalThis.navigator.userAgent) || '';

export const IE = /Trident|MSIE/.test(ua);
export const EDGE = /Edge\//.test(ua);
export const FIREFOX = /Firefox\//.test(ua) && !/Seamonkey/.test(ua);
export const CHROME = /Chrome\/|CriOS\//.test(ua) && !EDGE;
export const SAFARI = /Safari\//.test(ua) && !CHROME && !EDGE && !/Android/.test(ua);
