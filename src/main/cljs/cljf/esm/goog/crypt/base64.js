// Copyright The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// goog.crypt.base64 as an ES module, from the Closure Library sources.

import { stringToByteArray, stringToUtf8ByteArray } from '../crypt.js';

const DEFAULT_ALPHABET_COMMON = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const ENCODED_VALS = DEFAULT_ALPHABET_COMMON + '+/=';
export const ENCODED_VALS_WEBSAFE = DEFAULT_ALPHABET_COMMON + '-_.';

export const Alphabet = {
  DEFAULT: 0,
  NO_PADDING: 1,
  WEBSAFE: 2,
  WEBSAFE_DOT_PADDING: 3,
  WEBSAFE_NO_PADDING: 4,
};

const isPadding = (char) => '=.'.includes(char);

const byteToCharMaps = {};
let charToByteMap = null;

// Closure Library's are the browsers' and Node.js' btoa and atob
const HAS_NATIVE_ENCODE = typeof globalThis.btoa == 'function';
const HAS_NATIVE_DECODE = typeof globalThis.atob == 'function';

function init() {
  if (charToByteMap) return;
  charToByteMap = {};
  const commonChars = DEFAULT_ALPHABET_COMMON.split('');
  const specialChars = [
    '+/=', // DEFAULT
    '+/', // NO_PADDING
    '-_=', // WEBSAFE
    '-_.', // WEBSAFE_DOT_PADDING
    '-_', // WEBSAFE_NO_PADDING
  ];
  for (let i = 0; i < 5; i++) {
    const chars = commonChars.concat(specialChars[i].split(''));
    byteToCharMaps[i] = chars;
    for (let j = 0; j < chars.length; j++) {
      if (charToByteMap[chars[j]] === undefined) charToByteMap[chars[j]] = j;
    }
  }
}

export function encodeByteArray(input, alphabet) {
  if (!(input != null && typeof input === 'object' && typeof input.length === 'number')) {
    throw new Error('Assertion failed: encodeByteArray takes an array as a parameter');
  }
  if (alphabet === undefined) alphabet = Alphabet.DEFAULT;
  init();
  const byteToCharMap = byteToCharMaps[alphabet];
  const output = new Array(Math.floor(input.length / 3));
  const paddingChar = byteToCharMap[64] || '';
  let inputIdx = 0;
  let outputIdx = 0;
  for (; inputIdx < input.length - 2; inputIdx += 3) {
    const byte1 = input[inputIdx];
    const byte2 = input[inputIdx + 1];
    const byte3 = input[inputIdx + 2];
    const outChar1 = byteToCharMap[byte1 >> 2];
    const outChar2 = byteToCharMap[((byte1 & 0x03) << 4) | (byte2 >> 4)];
    const outChar3 = byteToCharMap[((byte2 & 0x0f) << 2) | (byte3 >> 6)];
    const outChar4 = byteToCharMap[byte3 & 0x3f];
    output[outputIdx++] = '' + outChar1 + outChar2 + outChar3 + outChar4;
  }
  let byte2 = 0;
  let outChar3 = paddingChar;
  switch (input.length - inputIdx) {
    case 2:
      byte2 = input[inputIdx + 1];
      outChar3 = byteToCharMap[(byte2 & 0x0f) << 2] || paddingChar;
    // fall through
    case 1: {
      const byte1 = input[inputIdx];
      const outChar1 = byteToCharMap[byte1 >> 2];
      const outChar2 = byteToCharMap[((byte1 & 0x03) << 4) | (byte2 >> 4)];
      output[outputIdx] = '' + outChar1 + outChar2 + outChar3 + paddingChar;
    }
  }
  return output.join('');
}

export function encodeString(input, alphabet, throwSync) {
  if (HAS_NATIVE_ENCODE && !alphabet) return globalThis.btoa(input);
  return encodeByteArray(stringToByteArray(input, throwSync), alphabet);
}

export function encodeBinaryString(input, alphabet) {
  return encodeString(input, alphabet, true);
}

export function encodeText(input, alphabet) {
  if (HAS_NATIVE_ENCODE && !alphabet) return globalThis.btoa(unescape(encodeURIComponent(input)));
  return encodeByteArray(stringToUtf8ByteArray(input), alphabet);
}

export const encodeStringUtf8 = encodeText;

function decodeStringInternal(input, pushByte) {
  init();
  let nextCharIndex = 0;
  function getByte(defaultVal) {
    while (nextCharIndex < input.length) {
      const ch = input.charAt(nextCharIndex++);
      const b = charToByteMap[ch];
      if (b != null) return b;
      if (!/^[\s\xa0]*$/.test(ch)) throw new Error('Unknown base64 encoding at char: ' + ch);
    }
    return defaultVal;
  }
  while (true) {
    const byte1 = getByte(-1);
    const byte2 = getByte(0);
    const byte3 = getByte(64);
    const byte4 = getByte(64);
    // no input left to decode
    if (byte4 === 64 && byte1 === -1) return;
    pushByte((byte1 << 2) | (byte2 >> 4));
    if (byte3 != 64) {
      pushByte(((byte2 << 4) & 0xf0) | (byte3 >> 2));
      if (byte4 != 64) pushByte(((byte3 << 6) & 0xc0) | byte4);
    }
  }
}

export function decodeToBinaryString(input, useCustomDecoder) {
  if (HAS_NATIVE_DECODE && !useCustomDecoder) return globalThis.atob(input);
  let output = '';
  decodeStringInternal(input, (b) => { output += String.fromCharCode(b); });
  return output;
}

export const decodeString = decodeToBinaryString;

export function decodeToText(input, useCustomDecoder) {
  return decodeURIComponent(escape(decodeString(input, useCustomDecoder)));
}

export const decodeStringUtf8 = decodeToText;

export function decodeStringToByteArray(input, opt_ignored) {
  const output = [];
  decodeStringInternal(input, (b) => { output.push(b); });
  return output;
}

export function decodeStringToUint8Array(input) {
  const len = input.length;
  let approxByteLength = len * 3 / 4;
  if (approxByteLength % 3) {
    approxByteLength = Math.floor(approxByteLength);
  } else if (isPadding(input[len - 1])) {
    approxByteLength -= isPadding(input[len - 2]) ? 2 : 1;
  }
  const output = new Uint8Array(approxByteLength);
  let outLen = 0;
  decodeStringInternal(input, (b) => { output[outLen++] = b; });
  return outLen !== approxByteLength ? output.subarray(0, outLen) : output;
}
