// Copyright 2006 The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The subset of goog.object used by ClojureScript, as an ES module.

export function get(obj, key, val = undefined) {
  if (obj !== null && key in obj) {
    return obj[key];
  }
  return val;
}

export function set(obj, key, value) {
  obj[key] = value;
}

export function containsKey(obj, key) {
  return obj !== null && key in obj;
}

export function getKeys(obj) {
  const res = [];
  let i = 0;
  for (const key in obj) {
    res[i++] = key;
  }
  return res;
}

export function getValues(obj) {
  const res = [];
  let i = 0;
  for (const key in obj) {
    res[i++] = obj[key];
  }
  return res;
}

export function forEach(obj, f, opt_obj) {
  for (const key in obj) {
    f.call(opt_obj, obj[key], key, obj);
  }
}

export function equals(a, b) {
  for (const k in a) {
    if (!(k in b) || a[k] !== b[k]) {
      return false;
    }
  }
  for (const k in b) {
    if (!(k in a)) {
      return false;
    }
  }
  return true;
}

export function clone(obj) {
  const res = {};
  for (const key in obj) {
    res[key] = obj[key];
  }
  return res;
}

export function create(var_args) {
  const argLength = arguments.length;
  if (argLength == 1 && Array.isArray(arguments[0])) {
    return create.apply(null, arguments[0]);
  }
  if (argLength % 2) {
    throw new Error('Uneven number of arguments');
  }
  const rv = {};
  for (let i = 0; i < argLength; i += 2) {
    rv[arguments[i]] = arguments[i + 1];
  }
  return rv;
}

export function getValueByKeys(obj, var_args) {
  const isArrayLike = var_args != null && typeof var_args === 'object' && typeof var_args.length === 'number';
  const keys = isArrayLike ? var_args : arguments;
  for (let i = isArrayLike ? 0 : 1; i < keys.length; i++) {
    if (obj == null) return undefined;
    obj = obj[keys[i]];
  }
  return obj;
}

const PROTOTYPE_FIELDS = [
  'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
  'toLocaleString', 'toString', 'valueOf',
];

export function extend(target, var_args) {
  for (let i = 1; i < arguments.length; i++) {
    const source = arguments[i];
    for (const key in source) {
      target[key] = source[key];
    }
    // own non-enumerable-on-the-prototype keys for-in skips
    for (const key of PROTOTYPE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        target[key] = source[key];
      }
    }
  }
}
