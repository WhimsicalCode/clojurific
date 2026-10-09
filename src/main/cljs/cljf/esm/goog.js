// Copyright 2006 The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The subset of Closure Library's base.js used by ClojureScript, as an ES
// module for :module-format :esm.

export let global = globalThis;

export function typeOf(value) {
  const s = typeof value;
  if (s != 'object') return s;
  if (!value) return 'null';
  if (Array.isArray(value)) return 'array';
  return s;
}

export function isArrayLike(val) {
  const type = typeOf(val);
  return type == 'array' || (type == 'object' && typeof val.length == 'number');
}

export function isObject(val) {
  const type = typeof val;
  return (type == 'object' && val != null) || type == 'function';
}

const UID_PROPERTY = 'closure_uid_' + ((Math.random() * 1e9) >>> 0);
let uidCounter = 0;

// Non-extensible (frozen, sealed) objects can't be given a uid property. Closure's
// non-strict getUid silently returns a new uid on every call for them, ES modules
// are strict mode, where the assignment throws. They get stable uids from a
// WeakMap instead.
const frozenUids = new WeakMap();

export function getUid(obj) {
  if (Object.prototype.hasOwnProperty.call(obj, UID_PROPERTY) && obj[UID_PROPERTY]) {
    return obj[UID_PROPERTY];
  }
  if (!Object.isExtensible(obj)) {
    let uid = frozenUids.get(obj);
    if (uid === undefined) frozenUids.set(obj, (uid = ++uidCounter));
    return uid;
  }
  return (obj[UID_PROPERTY] = ++uidCounter);
}

// :closure-defines are substituted at compile time, a runtime override can
// still be provided through CLOSURE_DEFINES.
export function define(name, defaultValue) {
  const defines = globalThis.CLOSURE_DEFINES;
  if (defines && Object.prototype.hasOwnProperty.call(defines, name)) {
    return defines[name];
  }
  return defaultValue;
}

export const DEBUG = define('goog.DEBUG', true);

// cljs.core only checks for instances of goog.Uri, instances of the Closure
// Library's goog.Uri, when the compatibility layer loaded it, are instances too.
// A stub, other namespaces get the Closure Library's goog.Uri.
export /* stub */ class Uri {
  static [Symbol.hasInstance](x) {
    if (Function.prototype[Symbol.hasInstance].call(Uri, x)) return true;
    const real = globalThis.goog && globalThis.goog.Uri;
    return real && real !== Uri ? x instanceof real : false;
  }
}

// ^:export, makes value reachable as a global, i.e. my.app.init
export function exportSymbol(path, value) {
  const parts = path.split('.');
  let cur = globalThis;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]] || (cur[parts[i]] = {});
  }
  cur[parts[parts.length - 1]] = value;
}

export /* stub */ function nodeGlobalRequire(path) {
  throw new Error('nodeGlobalRequire is not supported by ES module output: ' + path);
}

export function $$set(name, v) {
  switch (name) {
    case 'global': return (global = v);
  }
  throw new Error('No var goog/' + name);
}
