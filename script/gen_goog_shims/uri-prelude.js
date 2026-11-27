// Copyright The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// goog.Uri, goog.Uri.QueryData and goog.uri.utils as an ES module,
// mechanically converted from the Closure Library sources by running them
// against a module-local goog. goog.Uri is a class and a namespace: the class
// is the goog shim's Uri too (cljs.core's goog.Uri stub recognises its
// instances), the namespace's members (goog.Uri/parse, goog.Uri.QueryData)
// are this module's exports.
//
// provides: goog.provide goog.global goog.define goog.asserts goog.array goog.string goog.structs

import { isArrayLike } from '../goog.js';
import { startsWith, endsWith, contains } from './string.js';
import { getKeys, getValues } from './object.js';

function assert(condition, opt_message) {
  if (!condition) throw new Error('Assertion failed' + (opt_message ? ': ' + opt_message : ''));
  return condition;
}

const assertType = (test, expected) => (value) => {
  if (!test(value)) throw new Error('Assertion failed: Expected ' + expected + ' but got ' + typeof value + ': ' + value + '.');
  return value;
};

const goog = {
  // goog.provide: the namespace's objects, as Closure Library's
  provide(name) {
    let cur = goog;
    for (const part of name.split('.').slice(1)) cur = cur[part] || (cur[part] = {});
  },
  global: globalThis,
  define: (name, defaultValue) => defaultValue,
  asserts: {
    assert,
    assertArray: assertType(Array.isArray, 'array'),
    assertNumber: assertType((v) => typeof v === 'number', 'number'),
    assertString: assertType((v) => typeof v === 'string', 'string'),
  },
  array: {
    clone: (arr) => Array.prototype.slice.call(arr),
    contains: (arr, obj) => Array.prototype.indexOf.call(arr, obj) >= 0,
  },
  string: {
    startsWith,
    endsWith,
    contains,
    urlEncode: (str) => encodeURIComponent(String(str)),
    urlDecode: (str) => decodeURIComponent(str.replace(/\+/g, ' ')),
    getRandomString() {
      const x = 2147483648;
      return Math.floor(Math.random() * x).toString(36) +
          Math.abs(Math.floor(Math.random() * x) ^ Date.now()).toString(36);
    },
  },
  structs: {
    getKeys(col) {
      if (col.getKeys && typeof col.getKeys == 'function') return col.getKeys();
      if (col.getValues && typeof col.getValues == 'function') return undefined;
      if (col instanceof Map) return Array.from(col.keys());
      if (col instanceof Set) return undefined;
      if (isArrayLike(col) || typeof col === 'string') return Array.from({ length: col.length }, (_, i) => i);
      return getKeys(col);
    },
    getValues(col) {
      if (col.getValues && typeof col.getValues == 'function') return col.getValues();
      if (col instanceof Map || col instanceof Set) return Array.from(col.values());
      if (typeof col === 'string') return col.split('');
      if (isArrayLike(col)) return Array.prototype.slice.call(col);
      return getValues(col);
    },
    forEach(col, f, opt_obj) {
      if (col.forEach && typeof col.forEach == 'function') {
        col.forEach(f, opt_obj);
      } else if (isArrayLike(col) || typeof col === 'string') {
        Array.prototype.forEach.call(col, f, opt_obj);
      } else {
        const keys = goog.structs.getKeys(col);
        const values = goog.structs.getValues(col);
        for (let i = 0; i < values.length; i++) f.call(opt_obj, values[i], keys && keys[i], col);
      }
    },
  },
};
