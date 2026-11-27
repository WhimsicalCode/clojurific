// Copyright The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// goog.net.XhrIo, goog.net.Cookies, goog.net.EventType, goog.net.ErrorCode,
// goog.net.HttpStatus and goog.net.XmlHttp as an ES module, with the
// goog.events.EventTarget XhrIo extends, mechanically converted from the
// Closure Library sources by running them against a module-local goog. Closure
// Library classes are constructor functions here too, so subclasses and
// protocol extensions use them as they are. goog.net.Jsonp, at the end, is
// written for this module. goog.net.cookies is undefined, as in the Closure
// Library: goog.net.Cookies.getInstance() is the document's.
//
// provides: goog.provide goog.global goog.define goog.bind goog.partial goog.inherits goog.scope goog.abstractMethod goog.getUid goog.dispose goog.disposeAll goog.asserts goog.array goog.object goog.string goog.log goog.debug goog.json goog.uri goog.userAgent goog.Timer goog.events.listen goog.events.unlisten

import { getUid } from '../goog.js';
import { listen, unlisten } from './events.js';
import { trim, isEmptyOrWhitespace } from './string.js';
import { extend } from './object.js';

function assert(condition, opt_message) {
  if (!condition) throw new Error('Assertion failed' + (opt_message ? ': ' + opt_message : ''));
  return condition;
}

// goog.inherits
function inherits(childCtor, parentCtor) {
  childCtor.superClass_ = parentCtor.prototype;
  childCtor.prototype = Object.create(parentCtor.prototype);
  childCtor.prototype.constructor = childCtor;
  childCtor.base = function(me, methodName, ...args) {
    return parentCtor.prototype[methodName].apply(me, args);
  };
}

// goog.Uri's, see goog/Uri.js
const splitRe = /^(?:([^:/?#.]+):)?(?:\/\/(?:([^\\/?#]*)@)?([^\\/?#]*?)(?::([0-9]+))?(?=[\\/?#]|$))?([^?#]+)?(?:\?([^#]*))?(?:#([\s\S]*))?$/;

function getEffectiveScheme(uri) {
  let scheme = uri.match(splitRe)[1] || null;
  if (!scheme && globalThis.self && globalThis.self.location) {
    scheme = globalThis.self.location.protocol.slice(0, -1);
  }
  return scheme ? scheme.toLowerCase() : '';
}

const goog = {
  // goog.provide: the namespace's objects, as Closure Library's
  provide(name) {
    let cur = goog;
    for (const part of name.split('.').slice(1)) cur = cur[part] || (cur[part] = {});
  },
  global: globalThis,
  define: (name, defaultValue) => defaultValue,
  bind: (fn, selfObj, ...args) => fn.bind(selfObj, ...args),
  partial: (fn, ...args) => function(...rest) { return fn.apply(this, args.concat(rest)); },
  inherits,
  scope: (fn) => fn.call(globalThis),
  abstractMethod() {
    throw new Error('unimplemented abstract method');
  },
  getUid,
  dispose(obj) {
    if (obj && typeof obj.dispose == 'function') obj.dispose();
  },
  disposeAll(...args) {
    for (const arg of args) {
      if (arg != null && typeof arg === 'object' && typeof arg.length === 'number') goog.disposeAll(...arg);
      else goog.dispose(arg);
    }
  },
  asserts: { assert },
  array: {
    contains: (arr, obj) => Array.prototype.indexOf.call(arr, obj) >= 0,
    removeAt: (arr, i) => Array.prototype.splice.call(arr, i, 1).length == 1,
    remove(arr, obj) {
      const i = Array.prototype.indexOf.call(arr, obj);
      return i >= 0 && goog.array.removeAt(arr, i);
    },
  },
  object: {
    extend,
    map(obj, f, opt_obj) {
      const res = {};
      for (const key in obj) res[key] = f.call(opt_obj, obj[key], key, obj);
      return res;
    },
    some(obj, f, opt_obj) {
      for (const key in obj) if (f.call(opt_obj, obj[key], key, obj)) return true;
      return false;
    },
  },
  string: {
    trim,
    isEmptyOrWhitespace,
    caseInsensitiveEquals: (str1, str2) => str1.toLowerCase() == str2.toLowerCase(),
    splitLimit(str, separator, limit) {
      const parts = str.split(separator);
      const returnVal = [];
      while (limit > 0 && parts.length) {
        returnVal.push(parts.shift());
        limit--;
      }
      if (parts.length) returnVal.push(parts.join(separator));
      return returnVal;
    },
  },
  // goog.log is off in Closure Library builds without goog.DEBUG logging
  log: { getLogger: () => null, fine() {}, error() {} },
  debug: { entryPointRegistry: { register() {} } },
  json: { hybrid: { parse: (text) => JSON.parse(text) } },
  uri: { utils: { getEffectiveScheme } },
  userAgent: { IE: false },
  Timer: {
    callOnce(listener, opt_delay, opt_handler) {
      const fn = typeof listener === 'function' ? listener.bind(opt_handler) : listener.handleEvent.bind(listener);
      return setTimeout(fn, opt_delay || 0);
    },
    clear: (timerId) => clearTimeout(timerId),
  },
  events: { listen, unlisten },
};
