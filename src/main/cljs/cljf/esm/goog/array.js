// Copyright 2006 The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The subset of goog.array used by ClojureScript, as an ES module.

export function defaultCompare(a, b) {
  return a > b ? 1 : a < b ? -1 : 0;
}

export function toArray(object) {
  const length = object.length;
  if (length > 0) {
    const rv = new Array(length);
    for (let i = 0; i < length; i++) {
      rv[i] = object[i];
    }
    return rv;
  }
  return [];
}

export const clone = toArray;

export function shuffle(arr, opt_randFn) {
  const randFn = opt_randFn || Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(randFn() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

export function stableSort(arr, opt_compareFn) {
  const compArr = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    compArr[i] = {index: i, value: arr[i]};
  }
  const valueCompareFn = opt_compareFn || defaultCompare;
  compArr.sort((obj1, obj2) =>
      valueCompareFn(obj1.value, obj2.value) || obj1.index - obj2.index);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = compArr[i].value;
  }
}

export function isEmpty(arr) {
  return arr.length == 0;
}

export function splice(arr, index, howMany, var_args) {
  return Array.prototype.splice.apply(arr, Array.prototype.slice.call(arguments, 1));
}

export function insertArrayAt(arr, elementsToAdd, opt_i) {
  splice(arr, opt_i, 0, ...elementsToAdd);
}

export function removeAt(arr, i) {
  return Array.prototype.splice.call(arr, i, 1).length == 1;
}
