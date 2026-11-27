// Copyright The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// goog.crypt and goog.crypt.Sha256 as an ES module, from the Closure Library
// sources.

import { DEBUG } from '../goog.js';

export function stringToByteArray(str, throwSync) {
  const output = [];
  let p = 0;
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c > 0xff) {
      // Closure throws in debug builds only (and when asked to)
      if (DEBUG || throwSync) throw new Error('go/unicode-to-byte-error');
      output[p++] = c & 0xff;
      c >>= 8;
    }
    output[p++] = c;
  }
  return output;
}

export function binaryStringToByteArray(str) {
  return stringToByteArray(str, true);
}

export function byteArrayToBinaryString(bytes) {
  const CHUNK_SIZE = 8192;
  if (bytes.length <= CHUNK_SIZE) return String.fromCharCode.apply(null, bytes);
  let str = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    str += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, i + CHUNK_SIZE));
  }
  return str;
}

export const byteArrayToString = byteArrayToBinaryString;

export function byteArrayToHex(array, opt_separator) {
  return Array.prototype.map
    .call(array, (numByte) => {
      const hexByte = numByte.toString(16);
      return hexByte.length > 1 ? hexByte : '0' + hexByte;
    })
    .join(opt_separator || '');
}

export function hexToByteArray(hexString) {
  if (hexString.length % 2 != 0) throw new Error('Assertion failed: Key string length must be multiple of 2');
  const arr = [];
  for (let i = 0; i < hexString.length; i += 2) {
    arr.push(parseInt(hexString.substring(i, i + 2), 16));
  }
  return arr;
}

export function textToByteArray(str) {
  const out = [];
  let p = 0;
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 128) {
      out[p++] = c;
    } else if (c < 2048) {
      out[p++] = (c >> 6) | 192;
      out[p++] = (c & 63) | 128;
    } else if (((c & 0xfc00) == 0xd800) && i + 1 < str.length &&
               ((str.charCodeAt(i + 1) & 0xfc00) == 0xdc00)) {
      // surrogate pair
      c = 0x10000 + ((c & 0x03ff) << 10) + (str.charCodeAt(++i) & 0x03ff);
      out[p++] = (c >> 18) | 240;
      out[p++] = ((c >> 12) & 63) | 128;
      out[p++] = ((c >> 6) & 63) | 128;
      out[p++] = (c & 63) | 128;
    } else {
      out[p++] = (c >> 12) | 224;
      out[p++] = ((c >> 6) & 63) | 128;
      out[p++] = (c & 63) | 128;
    }
  }
  return out;
}

export const stringToUtf8ByteArray = textToByteArray;

export function byteArrayToText(bytes) {
  const out = [];
  let pos = 0, c = 0;
  while (pos < bytes.length) {
    const c1 = bytes[pos++];
    if (c1 < 128) {
      out[c++] = String.fromCharCode(c1);
    } else if (c1 > 191 && c1 < 224) {
      const c2 = bytes[pos++];
      out[c++] = String.fromCharCode(((c1 & 31) << 6) | (c2 & 63));
    } else if (c1 > 239 && c1 < 365) {
      // surrogate pair
      const c2 = bytes[pos++];
      const c3 = bytes[pos++];
      const c4 = bytes[pos++];
      const u = (((c1 & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63)) - 0x10000;
      out[c++] = String.fromCharCode(0xd800 + (u >> 10));
      out[c++] = String.fromCharCode(0xdc00 + (u & 1023));
    } else {
      const c2 = bytes[pos++];
      const c3 = bytes[pos++];
      out[c++] = String.fromCharCode(((c1 & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
    }
  }
  return out.join('');
}

export const utf8ByteArrayToString = byteArrayToText;

export function xorByteArray(bytes1, bytes2) {
  if (bytes1.length != bytes2.length) throw new Error('Assertion failed: XOR array lengths must match');
  const result = [];
  for (let i = 0; i < bytes1.length; i++) result.push(bytes1[i] ^ bytes2[i]);
  return result;
}

// goog.crypt.Hash and goog.crypt.Sha2 aren't exported: their namespaces
// stay the Closure Library's, whose subclasses call their constructors without
// new (goog.inherits), which classes don't allow
class Hash {
  constructor() {
    this.blockSize = -1;
  }
}

const BLOCKSIZE = 512 / 8;
const PADDING = [128].concat(new Array(BLOCKSIZE - 1).fill(0));

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

// goog.crypt.Sha2, the SHA-2 family's 32-bit word variants
class Sha2 extends Hash {
  constructor(numHashBlocks, initHashBlocks) {
    super();
    this.blockSize = BLOCKSIZE;
    this.chunk_ = new Uint8Array(this.blockSize);
    this.inChunk_ = 0;
    this.total_ = 0;
    this.hash_ = [];
    this.numHashBlocks_ = numHashBlocks;
    this.initHashBlocks_ = initHashBlocks;
    this.w_ = new Int32Array(64);
    this.reset();
  }

  reset() {
    this.inChunk_ = 0;
    this.total_ = 0;
    this.hash_ = new Int32Array(this.initHashBlocks_);
  }

  computeChunk_() {
    const chunk = this.chunk_;
    const rounds = 64;
    const w = this.w_;
    let index = 0;
    let offset = 0;
    while (offset < chunk.length) {
      w[index++] = (chunk[offset] << 24) | (chunk[offset + 1] << 16) |
          (chunk[offset + 2] << 8) | (chunk[offset + 3]);
      offset = index * 4;
    }
    for (let i = 16; i < rounds; i++) {
      const w_15 = w[i - 15] | 0;
      const s0 = ((w_15 >>> 7) | (w_15 << 25)) ^ ((w_15 >>> 18) | (w_15 << 14)) ^ (w_15 >>> 3);
      const w_2 = w[i - 2] | 0;
      const s1 = ((w_2 >>> 17) | (w_2 << 15)) ^ ((w_2 >>> 19) | (w_2 << 13)) ^ (w_2 >>> 10);
      const partialSum1 = ((w[i - 16] | 0) + s0) | 0;
      const partialSum2 = ((w[i - 7] | 0) + s1) | 0;
      w[i] = (partialSum1 + partialSum2) | 0;
    }
    let a = this.hash_[0] | 0;
    let b = this.hash_[1] | 0;
    let c = this.hash_[2] | 0;
    let d = this.hash_[3] | 0;
    let e = this.hash_[4] | 0;
    let f = this.hash_[5] | 0;
    let g = this.hash_[6] | 0;
    let h = this.hash_[7] | 0;
    for (let i = 0; i < rounds; i++) {
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = ((a & b) ^ (a & c) ^ (b & c));
      const t2 = (S0 + maj) | 0;
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = ((e & f) ^ ((~e) & g));
      const partialSum1 = (h + S1) | 0;
      const partialSum2 = (ch + (K[i] | 0)) | 0;
      const partialSum3 = (partialSum2 + (w[i] | 0)) | 0;
      const t1 = (partialSum1 + partialSum3) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    this.hash_[0] = (this.hash_[0] + a) | 0;
    this.hash_[1] = (this.hash_[1] + b) | 0;
    this.hash_[2] = (this.hash_[2] + c) | 0;
    this.hash_[3] = (this.hash_[3] + d) | 0;
    this.hash_[4] = (this.hash_[4] + e) | 0;
    this.hash_[5] = (this.hash_[5] + f) | 0;
    this.hash_[6] = (this.hash_[6] + g) | 0;
    this.hash_[7] = (this.hash_[7] + h) | 0;
  }

  update(message, opt_length) {
    if (opt_length === undefined) opt_length = message.length;
    let n = 0;
    let inChunk = this.inChunk_;
    if (typeof message === 'string') {
      while (n < opt_length) {
        this.chunk_[inChunk++] = message.charCodeAt(n++);
        if (inChunk == this.blockSize) {
          this.computeChunk_();
          inChunk = 0;
        }
      }
    } else if (message != null && typeof message === 'object' && typeof message.length === 'number') {
      while (n < opt_length) {
        const b = message[n++];
        if (!('number' == typeof b && 0 <= b && 255 >= b && b == (b | 0))) {
          throw new Error('message must be a byte array');
        }
        this.chunk_[inChunk++] = b;
        if (inChunk == this.blockSize) {
          this.computeChunk_();
          inChunk = 0;
        }
      }
    } else {
      throw new Error('message must be string or array');
    }
    this.inChunk_ = inChunk;
    this.total_ += opt_length;
  }

  digest() {
    const digest = [];
    let totalBits = this.total_ * 8;
    if (this.inChunk_ < 56) {
      this.update(PADDING, 56 - this.inChunk_);
    } else {
      this.update(PADDING, this.blockSize - (this.inChunk_ - 56));
    }
    for (let i = 63; i >= 56; i--) {
      this.chunk_[i] = totalBits & 255;
      totalBits /= 256; // not a shift: totalBits may exceed 32 bits
    }
    this.computeChunk_();
    let n = 0;
    for (let i = 0; i < this.numHashBlocks_; i++) {
      for (let j = 24; j >= 0; j -= 8) {
        digest[n++] = ((this.hash_[i] >> j) & 255);
      }
    }
    return digest;
  }
}

const SHA256_INIT_HASH_BLOCK = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19
];

// goog.crypt.Sha256
export class Sha256 extends Sha2 {
  constructor() {
    super(8, SHA256_INIT_HASH_BLOCK);
  }
}
