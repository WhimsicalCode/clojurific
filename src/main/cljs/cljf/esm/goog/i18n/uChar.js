// Copyright The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The subset of goog.i18n.uChar used by ClojureScript libraries (instaparse),
// as an ES module, from the Closure Library sources.

export function isSupplementaryCodePoint(codePoint) {
  return codePoint >= 0x10000 && codePoint <= 0x10ffff;
}

export function isLeadSurrogateCodePoint(codePoint) {
  return codePoint >= 0xd800 && codePoint <= 0xdbff;
}

export function isTrailSurrogateCodePoint(codePoint) {
  return codePoint >= 0xdc00 && codePoint <= 0xdfff;
}

export function buildSupplementaryCodePoint(lead, trail) {
  if (isLeadSurrogateCodePoint(lead) && isTrailSurrogateCodePoint(trail)) {
    return 0x10000 + ((lead - 0xd800) << 10) + (trail - 0xdc00);
  }
  return null;
}

export function charCount(codePoint) {
  return isSupplementaryCodePoint(codePoint) ? 2 : 1;
}

// The code point at index, negative when index is a surrogate pair's trail
export function getCodePointAround(string, index) {
  const charCode = string.charCodeAt(index);
  if (isLeadSurrogateCodePoint(charCode) && index + 1 < string.length) {
    const trail = string.charCodeAt(index + 1);
    if (isTrailSurrogateCodePoint(trail)) return buildSupplementaryCodePoint(charCode, trail);
  } else if (isTrailSurrogateCodePoint(charCode) && index > 0) {
    const lead = string.charCodeAt(index - 1);
    if (isLeadSurrogateCodePoint(lead)) return -buildSupplementaryCodePoint(lead, charCode);
  }
  return charCode;
}

export function toCharCode(ch) {
  return getCodePointAround(ch, 0);
}

export function fromCharCode(code) {
  if (code == null || !(code >= 0 && code <= 0x10ffff)) return null;
  return String.fromCodePoint(code);
}
