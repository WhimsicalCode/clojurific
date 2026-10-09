
// goog.math.Long and goog.math.Integer as an ES module, mechanically converted
// from the Closure Library sources for :module-format :esm.

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

function reflectCache(cacheObj, key, valueFn, opt_keyFn) {
  const storedKey = opt_keyFn ? opt_keyFn(key) : key;
  if (Object.prototype.hasOwnProperty.call(cacheObj, storedKey)) {
    return cacheObj[storedKey];
  }
  return (cacheObj[storedKey] = valueFn(key));
}
/**
 * @license
 * Copyright The Closure Library Authors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Defines a Long class for representing a 64-bit two's-complement
 * integer value, which faithfully simulates the behavior of a Java "long". This
 * implementation is derived from LongLib in GWT.
 */



/**
 * Represents a 64-bit two's-complement integer, given its low and high 32-bit
 * values as *signed* integers.  See the from* functions below for more
 * convenient ways of constructing Longs.
 *
 * The internal representation of a long is the two given signed, 32-bit values.
 * We use 32-bit pieces because these are the size of integers on which
 * JavaScript performs bit-operations.  For operations like addition and
 * multiplication, we split each number into 16-bit pieces, which can easily be
 * multiplied within JavaScript's floating-point representation without overflow
 * or change in sign.
 *
 * In the algorithms below, we frequently reduce the negative case to the
 * positive case by negating the input(s) and then post-processing the result.
 * Note that we must ALWAYS check specially whether those values are MIN_VALUE
 * (-2^63) because -MIN_VALUE == MIN_VALUE (since 2^63 cannot be represented as
 * a positive number, it overflows back into a negative).  Not handling this
 * case would often result in infinite recursion.
 * @final
 */
class Long {
  /**
   * @param {number} low  The low (signed) 32 bits of the long.
   * @param {number} high  The high (signed) 32 bits of the long.
   */
  constructor(low, high) {
    /**
     * @const {number}
     * @private
     */
    this.low_ = low | 0;  // force into 32 signed bits.

    /**
     * @const {number}
     * @private
     */
    this.high_ = high | 0;  // force into 32 signed bits.
  }

  /** @return {number} The value, assuming it is a 32-bit integer. */
  toInt() {
    return this.low_;
  }

  /**
   * @return {number} The closest floating-point representation to this value.
   */
  toNumber() {
    return this.high_ * TWO_PWR_32_DBL_ + this.getLowBitsUnsigned();
  }

  /**
   * @return {boolean} if can be exactly represented using number (i.e.
   *     abs(value) < 2^53).
   */
  isSafeInteger() {
    var top11Bits = this.high_ >> 21;
    // If top11Bits are all 0s, then the number is between [0, 2^53-1]
    return top11Bits == 0
        // If top11Bits are all 1s, then the number is between [-1, -2^53]
        || (top11Bits == -1
            // and exclude -2^53
            && !(this.low_ == 0 && this.high_ == (0xffe00000 | 0)));
  }

  /**
   * @param {number=} opt_radix The radix in which the text should be written.
   * @return {string} The textual representation of this value.
   * @override
   */
  toString(opt_radix) {
    var radix = opt_radix || 10;
    if (radix < 2 || 36 < radix) {
      throw new Error('radix out of range: ' + radix);
    }

    // We can avoid very expensive division based code path for some common
    // cases.
    if (this.isSafeInteger()) {
      var asNumber = this.toNumber();
      // Shortcutting for radix 10 (common case) to avoid boxing via toString:
      // https://jsperf.com/tostring-vs-vs-if
      return radix == 10 ? ('' + asNumber) : asNumber.toString(radix);
    }

    // We need to split 64bit integer into: `a * radix**safeDigits + b` where
    // neither `a` nor `b` exceeds 53 bits, meaning that safeDigits can be any
    // number in a range: [(63 - 53) / log2(radix); 53 / log2(radix)].

    // Other options that need to be benchmarked:
    //   11..16 - (radix >> 2);
    //   10..13 - (radix >> 3);
    //   10..11 - (radix >> 4);
    var safeDigits = 14 - (radix >> 2);

    var radixPowSafeDigits = Math.pow(radix, safeDigits);
    var radixToPower =
        Long.fromBits(radixPowSafeDigits, radixPowSafeDigits / TWO_PWR_32_DBL_);

    var remDiv = this.div(radixToPower);
    var val = Math.abs(this.subtract(remDiv.multiply(radixToPower)).toNumber());
    var digits = radix == 10 ? ('' + val) : val.toString(radix);

    if (digits.length < safeDigits) {
      // Up to 13 leading 0s we might need to insert as the greatest safeDigits
      // value is 14 (for radix 2).
      digits = '0000000000000'.slice(digits.length - safeDigits) + digits;
    }

    val = remDiv.toNumber();
    return (radix == 10 ? val : val.toString(radix)) + digits;
  }

  /**
   * @param {number=} opt_radix The radix in which the text should be written.
   * @return {string} The unsigned textual representation of this value.
   */
  toUnsignedString(opt_radix) {
    // If the sign bit isn't even set just use the normal flow
    if (this.high_ >= 0) {
      return this.toString(opt_radix);
    }

    var radix = opt_radix || 10;
    if (radix < 2 || 36 < radix) {
      throw new Error('radix out of range: ' + radix);
    }
    // Use fromInt() to get the 64-bit representation of the radix as the entire
    // radix range should be cached.
    var longRadix = Long.fromInt(radix);
    // Divide as unsigned 64-bit numbers.
    var quotient = this.shiftRightUnsigned(1).div(longRadix).shiftLeft(1);
    var remainder = this.subtract(quotient.multiply(longRadix));
    // Check if we need to sign adjust the quotient.
    if (remainder.greaterThanOrEqual(longRadix)) {
      quotient = quotient.add(Long.getOne());
      remainder = this.subtract(quotient.multiply(longRadix));
    }
    return quotient.toString(radix) + remainder.toString(radix);
  }

  /** @return {number} The high 32-bits as a signed value. */
  getHighBits() {
    return this.high_;
  }

  /** @return {number} The low 32-bits as a signed value. */
  getLowBits() {
    return this.low_;
  }

  /** @return {number} The low 32-bits as an unsigned value. */
  getLowBitsUnsigned() {
    // The right shifting fixes negative values in the case when
    // intval >= 2^31; for more details see
    // https://github.com/google/closure-library/pull/498
    return this.low_ >>> 0;
  }

  /**
   * @return {number} Returns the number of bits needed to represent the
   *     absolute value of this Long.
   */
  getNumBitsAbs() {
    if (this.isNegative()) {
      if (this.equals(Long.getMinValue())) {
        return 64;
      } else {
        return this.negate().getNumBitsAbs();
      }
    } else {
      var val = this.high_ != 0 ? this.high_ : this.low_;
      for (var bit = 31; bit > 0; bit--) {
        if ((val & (1 << bit)) != 0) {
          break;
        }
      }
      return this.high_ != 0 ? bit + 33 : bit + 1;
    }
  }

  /** @return {boolean} Whether this value is zero. */
  isZero() {
    // Check low part first as there is high chance it's not 0.
    return this.low_ == 0 && this.high_ == 0;
  }

  /** @return {boolean} Whether this value is negative. */
  isNegative() {
    return this.high_ < 0;
  }

  /** @return {boolean} Whether this value is odd. */
  isOdd() {
    return (this.low_ & 1) == 1;
  }

  /**
   * Returns a hash code for this long object that similar java.lang.Long one.
   *
   * @return {number} 32 bit hash code for this object.
   */
  hashCode() {
    return this.getLowBits() ^ this.getHighBits();
  }

  /**
   * @param {?Long} other Long to compare against.
   * @return {boolean} Whether this Long equals the other.
   */
  equals(other) {
    // Compare low parts first as there is higher chance they are different.
    return (this.low_ == other.low_) && (this.high_ == other.high_);
  }

  /**
   * @param {?Long} other Long to compare against.
   * @return {boolean} Whether this Long does not equal the other.
   */
  notEquals(other) {
    return !this.equals(other);
  }

  /**
   * @param {?Long} other Long to compare against.
   * @return {boolean} Whether this Long is less than the other.
   */
  lessThan(other) {
    return this.compare(other) < 0;
  }

  /**
   * @param {?Long} other Long to compare against.
   * @return {boolean} Whether this Long is less than or equal to the other.
   */
  lessThanOrEqual(other) {
    return this.compare(other) <= 0;
  }

  /**
   * @param {?Long} other Long to compare against.
   * @return {boolean} Whether this Long is greater than the other.
   */
  greaterThan(other) {
    return this.compare(other) > 0;
  }

  /**
   * @param {?Long} other Long to compare against.
   * @return {boolean} Whether this Long is greater than or equal to the other.
   */
  greaterThanOrEqual(other) {
    return this.compare(other) >= 0;
  }

  /**
   * Compares this Long with the given one.
   * @param {?Long} other Long to compare against.
   * @return {number} 0 if they are the same, 1 if the this is greater, and -1
   *     if the given one is greater.
   */
  compare(other) {
    if (this.high_ == other.high_) {
      if (this.low_ == other.low_) {
        return 0;
      }
      return this.getLowBitsUnsigned() > other.getLowBitsUnsigned() ? 1 : -1;
    }
    return this.high_ > other.high_ ? 1 : -1;
  }

  /** @return {!Long} The negation of this value. */
  negate() {
    var negLow = (~this.low_ + 1) | 0;
    var overflowFromLow = !negLow;
    var negHigh = (~this.high_ + overflowFromLow) | 0;
    return Long.fromBits(negLow, negHigh);
  }

  /**
   * Returns the sum of this and the given Long.
   * @param {?Long} other Long to add to this one.
   * @return {!Long} The sum of this and the given Long.
   */
  add(other) {
    // Divide each number into 4 chunks of 16 bits, and then sum the chunks.

    var a48 = this.high_ >>> 16;
    var a32 = this.high_ & 0xFFFF;
    var a16 = this.low_ >>> 16;
    var a00 = this.low_ & 0xFFFF;

    var b48 = other.high_ >>> 16;
    var b32 = other.high_ & 0xFFFF;
    var b16 = other.low_ >>> 16;
    var b00 = other.low_ & 0xFFFF;

    var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
    c00 += a00 + b00;
    c16 += c00 >>> 16;
    c00 &= 0xFFFF;
    c16 += a16 + b16;
    c32 += c16 >>> 16;
    c16 &= 0xFFFF;
    c32 += a32 + b32;
    c48 += c32 >>> 16;
    c32 &= 0xFFFF;
    c48 += a48 + b48;
    c48 &= 0xFFFF;
    return Long.fromBits((c16 << 16) | c00, (c48 << 16) | c32);
  }

  /**
   * Returns the difference of this and the given Long.
   * @param {?Long} other Long to subtract from this.
   * @return {!Long} The difference of this and the given Long.
   */
  subtract(other) {
    return this.add(other.negate());
  }

  /**
   * Returns the product of this and the given long.
   * @param {?Long} other Long to multiply with this.
   * @return {!Long} The product of this and the other.
   */
  multiply(other) {
    if (this.isZero()) {
      return this;
    }
    if (other.isZero()) {
      return other;
    }

    // Divide each long into 4 chunks of 16 bits, and then add up 4x4 products.
    // We can skip products that would overflow.

    var a48 = this.high_ >>> 16;
    var a32 = this.high_ & 0xFFFF;
    var a16 = this.low_ >>> 16;
    var a00 = this.low_ & 0xFFFF;

    var b48 = other.high_ >>> 16;
    var b32 = other.high_ & 0xFFFF;
    var b16 = other.low_ >>> 16;
    var b00 = other.low_ & 0xFFFF;

    var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
    c00 += a00 * b00;
    c16 += c00 >>> 16;
    c00 &= 0xFFFF;
    c16 += a16 * b00;
    c32 += c16 >>> 16;
    c16 &= 0xFFFF;
    c16 += a00 * b16;
    c32 += c16 >>> 16;
    c16 &= 0xFFFF;
    c32 += a32 * b00;
    c48 += c32 >>> 16;
    c32 &= 0xFFFF;
    c32 += a16 * b16;
    c48 += c32 >>> 16;
    c32 &= 0xFFFF;
    c32 += a00 * b32;
    c48 += c32 >>> 16;
    c32 &= 0xFFFF;
    c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
    c48 &= 0xFFFF;
    return Long.fromBits((c16 << 16) | c00, (c48 << 16) | c32);
  }

  /**
   * Returns this Long divided by the given one.
   * @param {?Long} other Long by which to divide.
   * @return {!Long} This Long divided by the given one.
   */
  div(other) {
    if (other.isZero()) {
      throw new Error('division by zero');
    }
    if (this.isNegative()) {
      if (this.equals(Long.getMinValue())) {
        if (other.equals(Long.getOne()) || other.equals(Long.getNegOne())) {
          return Long.getMinValue();  // recall -MIN_VALUE == MIN_VALUE
        }
        if (other.equals(Long.getMinValue())) {
          return Long.getOne();
        }
        // At this point, we have |other| >= 2, so |this/other| < |MIN_VALUE|.
        var halfThis = this.shiftRight(1);
        var approx = halfThis.div(other).shiftLeft(1);
        if (approx.equals(Long.getZero())) {
          return other.isNegative() ? Long.getOne() : Long.getNegOne();
        }
        var rem = this.subtract(other.multiply(approx));
        var result = approx.add(rem.div(other));
        return result;
      }
      if (other.isNegative()) {
        return this.negate().div(other.negate());
      }
      return this.negate().div(other).negate();
    }
    if (this.isZero()) {
      return Long.getZero();
    }
    if (other.isNegative()) {
      if (other.equals(Long.getMinValue())) {
        return Long.getZero();
      }
      return this.div(other.negate()).negate();
    }

    // Repeat the following until the remainder is less than other:  find a
    // floating-point that approximates remainder / other *from below*, add this
    // into the result, and subtract it from the remainder.  It is critical that
    // the approximate value is less than or equal to the real value so that the
    // remainder never becomes negative.
    var res = Long.getZero();
    var rem = this;
    while (rem.greaterThanOrEqual(other)) {
      // Approximate the result of division. This may be a little greater or
      // smaller than the actual value.
      var approx = Math.max(1, Math.floor(rem.toNumber() / other.toNumber()));

      // We will tweak the approximate result by changing it in the 48-th digit
      // or the smallest non-fractional digit, whichever is larger.
      var log2 = Math.ceil(Math.log(approx) / Math.LN2);
      var delta = (log2 <= 48) ? 1 : Math.pow(2, log2 - 48);

      // Decrease the approximation until it is smaller than the remainder. Note
      // that if it is too large, the product overflows and is negative.
      var approxRes = Long.fromNumber(approx);
      var approxRem = approxRes.multiply(other);
      while (approxRem.isNegative() || approxRem.greaterThan(rem)) {
        approx -= delta;
        approxRes = Long.fromNumber(approx);
        approxRem = approxRes.multiply(other);
      }

      // We know the answer can't be zero... and actually, zero would cause
      // infinite recursion since we would make no progress.
      if (approxRes.isZero()) {
        approxRes = Long.getOne();
      }

      res = res.add(approxRes);
      rem = rem.subtract(approxRem);
    }
    return res;
  }

  /**
   * Returns this Long modulo the given one.
   * @param {?Long} other Long by which to mod.
   * @return {!Long} This Long modulo the given one.
   */
  modulo(other) {
    return this.subtract(this.div(other).multiply(other));
  }

  /** @return {!Long} The bitwise-NOT of this value. */
  not() {
    return Long.fromBits(~this.low_, ~this.high_);
  }

  /**
   * Returns the bitwise-AND of this Long and the given one.
   * @param {?Long} other The Long with which to AND.
   * @return {!Long} The bitwise-AND of this and the other.
   */
  and(other) {
    return Long.fromBits(this.low_ & other.low_, this.high_ & other.high_);
  }

  /**
   * Returns the bitwise-OR of this Long and the given one.
   * @param {?Long} other The Long with which to OR.
   * @return {!Long} The bitwise-OR of this and the other.
   */
  or(other) {
    return Long.fromBits(this.low_ | other.low_, this.high_ | other.high_);
  }

  /**
   * Returns the bitwise-XOR of this Long and the given one.
   * @param {?Long} other The Long with which to XOR.
   * @return {!Long} The bitwise-XOR of this and the other.
   */
  xor(other) {
    return Long.fromBits(this.low_ ^ other.low_, this.high_ ^ other.high_);
  }

  /**
   * Returns this Long with bits shifted to the left by the given amount.
   * @param {number} numBits The number of bits by which to shift.
   * @return {!Long} This shifted to the left by the given amount.
   */
  shiftLeft(numBits) {
    numBits &= 63;
    if (numBits == 0) {
      return this;
    } else {
      var low = this.low_;
      if (numBits < 32) {
        var high = this.high_;
        return Long.fromBits(
            low << numBits, (high << numBits) | (low >>> (32 - numBits)));
      } else {
        return Long.fromBits(0, low << (numBits - 32));
      }
    }
  }

  /**
   * Returns this Long with bits shifted to the right by the given amount.
   * The new leading bits match the current sign bit.
   * @param {number} numBits The number of bits by which to shift.
   * @return {!Long} This shifted to the right by the given amount.
   */
  shiftRight(numBits) {
    numBits &= 63;
    if (numBits == 0) {
      return this;
    } else {
      var high = this.high_;
      if (numBits < 32) {
        var low = this.low_;
        return Long.fromBits(
            (low >>> numBits) | (high << (32 - numBits)), high >> numBits);
      } else {
        return Long.fromBits(high >> (numBits - 32), high >= 0 ? 0 : -1);
      }
    }
  }

  /**
   * Returns this Long with bits shifted to the right by the given amount, with
   * zeros placed into the new leading bits.
   * @param {number} numBits The number of bits by which to shift.
   * @return {!Long} This shifted to the right by the given amount,
   *     with zeros placed into the new leading bits.
   */
  shiftRightUnsigned(numBits) {
    numBits &= 63;
    if (numBits == 0) {
      return this;
    } else {
      var high = this.high_;
      if (numBits < 32) {
        var low = this.low_;
        return Long.fromBits(
            (low >>> numBits) | (high << (32 - numBits)), high >>> numBits);
      } else if (numBits == 32) {
        return Long.fromBits(high, 0);
      } else {
        return Long.fromBits(high >>> (numBits - 32), 0);
      }
    }
  }

  /**
   * Returns a Long representing the given (32-bit) integer value.
   * @param {number} value The 32-bit integer in question.
   * @return {!Long} The corresponding Long value.
   */
  static fromInt(value) {
    var intValue = value | 0;
    assert(value === intValue, 'value should be a 32-bit integer');

    if (-128 <= intValue && intValue < 128) {
      return getCachedIntValue_(intValue);
    } else {
      return new Long(intValue, intValue < 0 ? -1 : 0);
    }
  }

  /**
   * Returns a Long representing the given value.
   * NaN will be returned as zero. Infinity is converted to max value and
   * -Infinity to min value.
   * @param {number} value The number in question.
   * @return {!Long} The corresponding Long value.
   */
  static fromNumber(value) {
    if (value > 0) {
      if (value >= TWO_PWR_63_DBL_) {
        return Long.getMaxValue();
      }
      return new Long(value, value / TWO_PWR_32_DBL_);
    } else if (value < 0) {
      if (value <= -TWO_PWR_63_DBL_) {
        return Long.getMinValue();
      }
      return new Long(-value, -value / TWO_PWR_32_DBL_).negate();
    } else {
      // NaN or 0.
      return Long.getZero();
    }
  }

  /**
   * Returns a Long representing the 64-bit integer that comes by concatenating
   * the given high and low bits.  Each is assumed to use 32 bits.
   * @param {number} lowBits The low 32-bits.
   * @param {number} highBits The high 32-bits.
   * @return {!Long} The corresponding Long value.
   */
  static fromBits(lowBits, highBits) {
    return new Long(lowBits, highBits);
  }

  /**
   * Returns a Long representation of the given string, written using the given
   * radix.
   * @param {string} str The textual representation of the Long.
   * @param {number=} opt_radix The radix in which the text is written.
   * @return {!Long} The corresponding Long value.
   */
  static fromString(str, opt_radix) {
    if (str.charAt(0) == '-') {
      return Long.fromString(str.substring(1), opt_radix).negate();
    }

    // We can avoid very expensive multiply based code path for some common
    // cases.
    var numberValue = parseInt(str, opt_radix || 10);
    if (numberValue <= MAX_SAFE_INTEGER_) {
      return new Long(
          (numberValue % TWO_PWR_32_DBL_) | 0,
          (numberValue / TWO_PWR_32_DBL_) | 0);
    }

    if (str.length == 0) {
      throw new Error('number format error: empty string');
    }
    if (str.indexOf('-') >= 0) {
      throw new Error('number format error: interior "-" character: ' + str);
    }

    var radix = opt_radix || 10;
    if (radix < 2 || 36 < radix) {
      throw new Error('radix out of range: ' + radix);
    }

    // Do several (8) digits each time through the loop, so as to
    // minimize the calls to the very expensive emulated multiply.
    var radixToPower = Long.fromNumber(Math.pow(radix, 8));

    var result = Long.getZero();
    for (var i = 0; i < str.length; i += 8) {
      var size = Math.min(8, str.length - i);
      var value = parseInt(str.substring(i, i + size), radix);
      if (size < 8) {
        var power = Long.fromNumber(Math.pow(radix, size));
        result = result.multiply(power).add(Long.fromNumber(value));
      } else {
        result = result.multiply(radixToPower);
        result = result.add(Long.fromNumber(value));
      }
    }
    return result;
  }

  /**
   * Returns the boolean value of whether the input string is within a Long's
   * range. Assumes an input string containing only numeric characters with an
   * optional preceding '-'.
   * @param {string} str The textual representation of the Long.
   * @param {number=} opt_radix The radix in which the text is written.
   * @return {boolean} Whether the string is within the range of a Long.
   */
  static isStringInRange(str, opt_radix) {
    var radix = opt_radix || 10;
    if (radix < 2 || 36 < radix) {
      throw new Error('radix out of range: ' + radix);
    }

    var extremeValue = (str.charAt(0) == '-') ? MIN_VALUE_FOR_RADIX_[radix] :
                                                MAX_VALUE_FOR_RADIX_[radix];

    if (str.length < extremeValue.length) {
      return true;
    } else if (str.length == extremeValue.length && str <= extremeValue) {
      return true;
    } else {
      return false;
    }
  }

  /**
   * @return {!Long}
   * @public
   */
  static getZero() {
    return ZERO_;
  }

  /**
   * @return {!Long}
   * @public
   */
  static getOne() {
    return ONE_;
  }

  /**
   * @return {!Long}
   * @public
   */
  static getNegOne() {
    return NEG_ONE_;
  }

  /**
   * @return {!Long}
   * @public
   */
  static getMaxValue() {
    return MAX_VALUE_;
  }

  /**
   * @return {!Long}
   * @public
   */
  static getMinValue() {
    return MIN_VALUE_;
  }

  /**
   * @return {!Long}
   * @public
   */
  static getTwoPwr24() {
    return TWO_PWR_24_;
  }
}


// NOTE: Common constant values ZERO, ONE, NEG_ONE, etc. are defined below the
// from* methods on which they depend.


/**
 * A cache of the Long representations of small integer values.
 * @type {!Object<number, !Long>}
 * @private @const
 */
const IntCache_ = {};


/**
 * Returns a cached long number representing the given (32-bit) integer value.
 * @param {number} value The 32-bit integer in question.
 * @return {!Long} The corresponding Long value.
 * @private
 */
function getCachedIntValue_(value) {
  return reflectCache(IntCache_, value, function(val) {
    return new Long(val, val < 0 ? -1 : 0);
  });
}

/**
 * The array of maximum values of a Long in string representation for a given
 * radix between 2 and 36, inclusive.
 * @private @const {!Array<string>}
 */
const MAX_VALUE_FOR_RADIX_ = [
  '', '',  // unused
  '111111111111111111111111111111111111111111111111111111111111111',
  // base 2
  '2021110011022210012102010021220101220221',  // base 3
  '13333333333333333333333333333333',          // base 4
  '1104332401304422434310311212',              // base 5
  '1540241003031030222122211',                 // base 6
  '22341010611245052052300',                   // base 7
  '777777777777777777777',                     // base 8
  '67404283172107811827',                      // base 9
  '9223372036854775807',                       // base 10
  '1728002635214590697',                       // base 11
  '41a792678515120367',                        // base 12
  '10b269549075433c37',                        // base 13
  '4340724c6c71dc7a7',                         // base 14
  '160e2ad3246366807',                         // base 15
  '7fffffffffffffff',                          // base 16
  '33d3d8307b214008',                          // base 17
  '16agh595df825fa7',                          // base 18
  'ba643dci0ffeehh',                           // base 19
  '5cbfjia3fh26ja7',                           // base 20
  '2heiciiie82dh97',                           // base 21
  '1adaibb21dckfa7',                           // base 22
  'i6k448cf4192c2',                            // base 23
  'acd772jnc9l0l7',                            // base 24
  '64ie1focnn5g77',                            // base 25
  '3igoecjbmca687',                            // base 26
  '27c48l5b37oaop',                            // base 27
  '1bk39f3ah3dmq7',                            // base 28
  'q1se8f0m04isb',                             // base 29
  'hajppbc1fc207',                             // base 30
  'bm03i95hia437',                             // base 31
  '7vvvvvvvvvvvv',                             // base 32
  '5hg4ck9jd4u37',                             // base 33
  '3tdtk1v8j6tpp',                             // base 34
  '2pijmikexrxp7',                             // base 35
  '1y2p0ij32e8e7'                              // base 36
];


/**
 * The array of minimum values of a Long in string representation for a given
 * radix between 2 and 36, inclusive.
 * @private @const {!Array<string>}
 */
const MIN_VALUE_FOR_RADIX_ = [
  '', '',  // unused
  '-1000000000000000000000000000000000000000000000000000000000000000',
  // base 2
  '-2021110011022210012102010021220101220222',  // base 3
  '-20000000000000000000000000000000',          // base 4
  '-1104332401304422434310311213',              // base 5
  '-1540241003031030222122212',                 // base 6
  '-22341010611245052052301',                   // base 7
  '-1000000000000000000000',                    // base 8
  '-67404283172107811828',                      // base 9
  '-9223372036854775808',                       // base 10
  '-1728002635214590698',                       // base 11
  '-41a792678515120368',                        // base 12
  '-10b269549075433c38',                        // base 13
  '-4340724c6c71dc7a8',                         // base 14
  '-160e2ad3246366808',                         // base 15
  '-8000000000000000',                          // base 16
  '-33d3d8307b214009',                          // base 17
  '-16agh595df825fa8',                          // base 18
  '-ba643dci0ffeehi',                           // base 19
  '-5cbfjia3fh26ja8',                           // base 20
  '-2heiciiie82dh98',                           // base 21
  '-1adaibb21dckfa8',                           // base 22
  '-i6k448cf4192c3',                            // base 23
  '-acd772jnc9l0l8',                            // base 24
  '-64ie1focnn5g78',                            // base 25
  '-3igoecjbmca688',                            // base 26
  '-27c48l5b37oaoq',                            // base 27
  '-1bk39f3ah3dmq8',                            // base 28
  '-q1se8f0m04isc',                             // base 29
  '-hajppbc1fc208',                             // base 30
  '-bm03i95hia438',                             // base 31
  '-8000000000000',                             // base 32
  '-5hg4ck9jd4u38',                             // base 33
  '-3tdtk1v8j6tpq',                             // base 34
  '-2pijmikexrxp8',                             // base 35
  '-1y2p0ij32e8e8'                              // base 36
];

/**
 * TODO(goktug): Replace with Number.MAX_SAFE_INTEGER when polyfil is guaranteed
 * to be removed.
 * @type {number}
 * @private @const
 */
const MAX_SAFE_INTEGER_ = 0x1fffffffffffff;

// NOTE: the compiler should inline these constant values below and then remove
// these variables, so there should be no runtime penalty for these.

/**
 * Number used repeated below in calculations.  This must appear before the
 * first call to any from* function above.
 * @const {number}
 * @private
 */
const TWO_PWR_32_DBL_ = 0x100000000;


/**
 * @const {number}
 * @private
 */
const TWO_PWR_63_DBL_ = 0x8000000000000000;


/**
 * @private @const {!Long}
 */
const ZERO_ = Long.fromBits(0, 0);


/**
 * @private @const {!Long}
 */
const ONE_ = Long.fromBits(1, 0);

/**
 * @private @const {!Long}
 */
const NEG_ONE_ = Long.fromBits(-1, -1);

/**
 * @private @const {!Long}
 */
const MAX_VALUE_ = Long.fromBits(0xFFFFFFFF, 0x7FFFFFFF);

/**
 * @private @const {!Long}
 */
const MIN_VALUE_ = Long.fromBits(0, 0x80000000);

/**
 * @private @const {!Long}
 */
const TWO_PWR_24_ = Long.fromBits(1 << 24, 0);

/**
 * @license
 * Copyright The Closure Library Authors.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Defines an Integer class for representing (potentially)
 * infinite length two's-complement integer values.
 *
 * For the specific case of 64-bit integers, use goog.math.Long, which is more
 * efficient.
 */



/**
 * Constructs a two's-complement integer an array containing bits of the
 * integer in 32-bit (signed) pieces, given in little-endian order (i.e.,
 * lowest-order bits in the first piece), and the sign of -1 or 0.
 *
 * See the from* functions below for other convenient ways of constructing
 * Integers.
 *
 * The internal representation of an integer is an array of 32-bit signed
 * pieces, along with a sign (0 or -1) that indicates the contents of all the
 * other 32-bit pieces out to infinity.  We use 32-bit pieces because these are
 * the size of integers on which JavaScript performs bit-operations.  For
 * operations like addition and multiplication, we split each number into 16-bit
 * pieces, which can easily be multiplied within JavaScript's floating-point
 * representation without overflow or change in sign.
 *
 * @struct
 * @constructor
 * @param {Array<number>} bits Array containing the bits of the number.
 * @param {number} sign The sign of the number: -1 for negative and 0 positive.
 * @final
 */
const Integer = function(bits, sign) {
  'use strict';
  /**
   * @type {number}
   * @private
   */
  this.sign_ = sign;

  // Note: using a local variable while initializing the array helps the
  // compiler understand that assigning to the array is local side-effect and
  // that enables the entire constructor to be seen as side-effect free.
  var localBits = [];

  // Copy the 32-bit signed integer values passed in.  We prune out those at the
  // top that equal the sign since they are redundant.
  var top = true;

  for (var i = bits.length - 1; i >= 0; i--) {
    var val = bits[i] | 0;
    if (!top || val != sign) {
      localBits[i] = val;
      top = false;
    }
  }

  /**
   * @type {!Array<number>}
   * @private
   * @const
   */
  this.bits_ = localBits;
};


// NOTE: Common constant values ZERO, ONE, NEG_ONE, etc. are defined below the
// from* methods on which they depend.


/**
 * A cache of the Integer representations of small integer values.
 * @type {!Object<number, !Integer>}
 * @private
 */
Integer.IntCache_ = {};


/**
 * Returns an Integer representing the given (32-bit) integer value.
 * @param {number} value A 32-bit integer value.
 * @return {!Integer} The corresponding Integer value.
 */
Integer.fromInt = function(value) {
  'use strict';
  if (-128 <= value && value < 128) {
    return reflectCache(
        Integer.IntCache_, value, function(val) {
          'use strict';
          return new Integer([val | 0], val < 0 ? -1 : 0);
        });
  }
  return new Integer([value | 0], value < 0 ? -1 : 0);
};


/**
 * Returns an Integer representing the given value, provided that it is a finite
 * number.  Otherwise, zero is returned.
 * @param {number} value The value in question.
 * @return {!Integer} The corresponding Integer value.
 */
Integer.fromNumber = function(value) {
  'use strict';
  if (isNaN(value) || !isFinite(value)) {
    return Integer.ZERO;
  } else if (value < 0) {
    return Integer.fromNumber(-value).negate();
  } else {
    var bits = [];
    var pow = 1;
    for (var i = 0; value >= pow; i++) {
      bits[i] = (value / pow) | 0;
      pow *= Integer.TWO_PWR_32_DBL_;
    }
    return new Integer(bits, 0);
  }
};


/**
 * Returns a Integer representing the value that comes by concatenating the
 * given entries, each is assumed to be 32 signed bits, given in little-endian
 * order (lowest order bits in the lowest index), and sign-extending the highest
 * order 32-bit value.
 * @param {Array<number>} bits The bits of the number, in 32-bit signed pieces,
 *     in little-endian order.
 * @return {!Integer} The corresponding Integer value.
 */
Integer.fromBits = function(bits) {
  'use strict';
  var high = bits[bits.length - 1];
  return new Integer(bits, high & (1 << 31) ? -1 : 0);
};


/**
 * Returns an Integer representation of the given string, written using the
 * given radix.
 * @param {string} str The textual representation of the Integer.
 * @param {number=} opt_radix The radix in which the text is written.
 * @return {!Integer} The corresponding Integer value.
 */
Integer.fromString = function(str, opt_radix) {
  'use strict';
  if (str.length == 0) {
    throw new Error('number format error: empty string');
  }

  var radix = opt_radix || 10;
  if (radix < 2 || 36 < radix) {
    throw new Error('radix out of range: ' + radix);
  }

  if (str.charAt(0) == '-') {
    return Integer.fromString(str.substring(1), radix).negate();
  } else if (str.indexOf('-') >= 0) {
    throw new Error('number format error: interior "-" character');
  }

  // Do several (8) digits each time through the loop, so as to
  // minimize the calls to the very expensive emulated div.
  var radixToPower = Integer.fromNumber(Math.pow(radix, 8));

  var result = Integer.ZERO;
  for (var i = 0; i < str.length; i += 8) {
    var size = Math.min(8, str.length - i);
    var value = parseInt(str.substring(i, i + size), radix);
    if (size < 8) {
      var power = Integer.fromNumber(Math.pow(radix, size));
      result = result.multiply(power).add(Integer.fromNumber(value));
    } else {
      result = result.multiply(radixToPower);
      result = result.add(Integer.fromNumber(value));
    }
  }
  return result;
};


/**
 * A number used repeatedly in calculations.  This must appear before the first
 * call to the from* functions below.
 * @type {number}
 * @private
 */
Integer.TWO_PWR_32_DBL_ = (1 << 16) * (1 << 16);


/**  @type {!Integer} */
Integer.ZERO = Integer.fromInt(0);

/**  @type {!Integer} */
Integer.ONE = Integer.fromInt(1);


/**
 * @const
 * @type {!Integer}
 * @private
 */
Integer.TWO_PWR_24_ = Integer.fromInt(1 << 24);

/**
 * Returns the value, assuming it is a 32-bit integer.
 * @return {number} The corresponding int value.
 */
Integer.prototype.toInt = function() {
  'use strict';
  return this.bits_.length > 0 ? this.bits_[0] : this.sign_;
};


/** @return {number} The closest floating-point representation to this value. */
Integer.prototype.toNumber = function() {
  'use strict';
  if (this.isNegative()) {
    return -this.negate().toNumber();
  } else {
    var val = 0;
    var pow = 1;
    for (var i = 0; i < this.bits_.length; i++) {
      val += this.getBitsUnsigned(i) * pow;
      pow *= Integer.TWO_PWR_32_DBL_;
    }
    return val;
  }
};


/**
 * @param {number=} opt_radix The radix in which the text should be written.
 * @return {string} The textual representation of this value.
 * @override
 */
Integer.prototype.toString = function(opt_radix) {
  'use strict';
  var radix = opt_radix || 10;
  if (radix < 2 || 36 < radix) {
    throw new Error('radix out of range: ' + radix);
  }

  if (this.isZero()) {
    return '0';
  } else if (this.isNegative()) {
    return '-' + this.negate().toString(radix);
  }

  // Do several (6) digits each time through the loop, so as to
  // minimize the calls to the very expensive emulated div.
  var radixToPower = Integer.fromNumber(Math.pow(radix, 6));

  var rem = this;
  var result = '';
  while (true) {
    var remDiv = rem.divide(radixToPower);
    // The right shifting fixes negative values in the case when
    // intval >= 2^31; for more details see
    // https://github.com/google/closure-library/pull/498
    var intval = rem.subtract(remDiv.multiply(radixToPower)).toInt() >>> 0;
    var digits = intval.toString(radix);

    rem = remDiv;
    if (rem.isZero()) {
      return digits + result;
    } else {
      while (digits.length < 6) {
        digits = '0' + digits;
      }
      result = '' + digits + result;
    }
  }
};


/**
 * Returns the index-th 32-bit (signed) piece of the Integer according to
 * little-endian order (i.e., index 0 contains the smallest bits).
 * @param {number} index The index in question.
 * @return {number} The requested 32-bits as a signed number.
 */
Integer.prototype.getBits = function(index) {
  'use strict';
  if (index < 0) {
    return 0;  // Allowing this simplifies bit shifting operations below...
  } else if (index < this.bits_.length) {
    return this.bits_[index];
  } else {
    return this.sign_;
  }
};


/**
 * Returns the index-th 32-bit piece as an unsigned number.
 * @param {number} index The index in question.
 * @return {number} The requested 32-bits as an unsigned number.
 */
Integer.prototype.getBitsUnsigned = function(index) {
  'use strict';
  var val = this.getBits(index);
  return val >= 0 ? val : Integer.TWO_PWR_32_DBL_ + val;
};


/** @return {number} The sign bit of this number, -1 or 0. */
Integer.prototype.getSign = function() {
  'use strict';
  return this.sign_;
};


/** @return {boolean} Whether this value is zero. */
Integer.prototype.isZero = function() {
  'use strict';
  if (this.sign_ != 0) {
    return false;
  }
  for (var i = 0; i < this.bits_.length; i++) {
    if (this.bits_[i] != 0) {
      return false;
    }
  }
  return true;
};


/** @return {boolean} Whether this value is negative. */
Integer.prototype.isNegative = function() {
  'use strict';
  return this.sign_ == -1;
};


/** @return {boolean} Whether this value is odd. */
Integer.prototype.isOdd = function() {
  'use strict';
  return (this.bits_.length == 0) && (this.sign_ == -1) ||
      (this.bits_.length > 0) && ((this.bits_[0] & 1) != 0);
};


/**
 * @param {Integer} other Integer to compare against.
 * @return {boolean} Whether this Integer equals the other.
 */
Integer.prototype.equals = function(other) {
  'use strict';
  if (this.sign_ != other.sign_) {
    return false;
  }
  var len = Math.max(this.bits_.length, other.bits_.length);
  for (var i = 0; i < len; i++) {
    if (this.getBits(i) != other.getBits(i)) {
      return false;
    }
  }
  return true;
};


/**
 * @param {Integer} other Integer to compare against.
 * @return {boolean} Whether this Integer does not equal the other.
 */
Integer.prototype.notEquals = function(other) {
  'use strict';
  return !this.equals(other);
};


/**
 * @param {Integer} other Integer to compare against.
 * @return {boolean} Whether this Integer is greater than the other.
 */
Integer.prototype.greaterThan = function(other) {
  'use strict';
  return this.compare(other) > 0;
};


/**
 * @param {Integer} other Integer to compare against.
 * @return {boolean} Whether this Integer is greater than or equal to the other.
 */
Integer.prototype.greaterThanOrEqual = function(other) {
  'use strict';
  return this.compare(other) >= 0;
};


/**
 * @param {Integer} other Integer to compare against.
 * @return {boolean} Whether this Integer is less than the other.
 */
Integer.prototype.lessThan = function(other) {
  'use strict';
  return this.compare(other) < 0;
};


/**
 * @param {Integer} other Integer to compare against.
 * @return {boolean} Whether this Integer is less than or equal to the other.
 */
Integer.prototype.lessThanOrEqual = function(other) {
  'use strict';
  return this.compare(other) <= 0;
};


/**
 * Compares this Integer with the given one.
 * @param {Integer} other Integer to compare against.
 * @return {number} 0 if they are the same, 1 if the this is greater, and -1
 *     if the given one is greater.
 */
Integer.prototype.compare = function(other) {
  'use strict';
  var diff = this.subtract(other);
  if (diff.isNegative()) {
    return -1;
  } else if (diff.isZero()) {
    return 0;
  } else {
    return +1;
  }
};


/**
 * Returns an integer with only the first numBits bits of this value, sign
 * extended from the final bit.
 * @param {number} numBits The number of bits by which to shift.
 * @return {!Integer} The shorted integer value.
 */
Integer.prototype.shorten = function(numBits) {
  'use strict';
  var arr_index = (numBits - 1) >> 5;
  var bit_index = (numBits - 1) % 32;
  var bits = [];
  for (var i = 0; i < arr_index; i++) {
    bits[i] = this.getBits(i);
  }
  var sigBits = bit_index == 31 ? 0xFFFFFFFF : (1 << (bit_index + 1)) - 1;
  var val = this.getBits(arr_index) & sigBits;
  if (val & (1 << bit_index)) {
    val |= 0xFFFFFFFF - sigBits;
    bits[arr_index] = val;
    return new Integer(bits, -1);
  } else {
    bits[arr_index] = val;
    return new Integer(bits, 0);
  }
};


/** @return {!Integer} The negation of this value. */
Integer.prototype.negate = function() {
  'use strict';
  return this.not().add(Integer.ONE);
};


/** @return {!Integer} The absolute value of this value. */
Integer.prototype.abs = function() {
  'use strict';
  return this.isNegative() ? this.negate() : this;
};


/**
 * Returns the sum of this and the given Integer.
 * @param {Integer} other The Integer to add to this.
 * @return {!Integer} The Integer result.
 */
Integer.prototype.add = function(other) {
  'use strict';
  var len = Math.max(this.bits_.length, other.bits_.length);
  var arr = [];
  var carry = 0;

  for (var i = 0; i <= len; i++) {
    var a1 = this.getBits(i) >>> 16;
    var a0 = this.getBits(i) & 0xFFFF;

    var b1 = other.getBits(i) >>> 16;
    var b0 = other.getBits(i) & 0xFFFF;

    var c0 = carry + a0 + b0;
    var c1 = (c0 >>> 16) + a1 + b1;
    carry = c1 >>> 16;
    c0 &= 0xFFFF;
    c1 &= 0xFFFF;
    arr[i] = (c1 << 16) | c0;
  }
  return Integer.fromBits(arr);
};


/**
 * Returns the difference of this and the given Integer.
 * @param {Integer} other The Integer to subtract from this.
 * @return {!Integer} The Integer result.
 */
Integer.prototype.subtract = function(other) {
  'use strict';
  return this.add(other.negate());
};


/**
 * Returns the product of this and the given Integer.
 * @param {Integer} other The Integer to multiply against this.
 * @return {!Integer} The product of this and the other.
 */
Integer.prototype.multiply = function(other) {
  'use strict';
  if (this.isZero()) {
    return Integer.ZERO;
  } else if (other.isZero()) {
    return Integer.ZERO;
  }

  if (this.isNegative()) {
    if (other.isNegative()) {
      return this.negate().multiply(other.negate());
    } else {
      return this.negate().multiply(other).negate();
    }
  } else if (other.isNegative()) {
    return this.multiply(other.negate()).negate();
  }

  // If both numbers are small, use float multiplication
  if (this.lessThan(Integer.TWO_PWR_24_) &&
      other.lessThan(Integer.TWO_PWR_24_)) {
    return Integer.fromNumber(this.toNumber() * other.toNumber());
  }

  // Fill in an array of 16-bit products.
  var len = this.bits_.length + other.bits_.length;
  var arr = [];
  for (var i = 0; i < 2 * len; i++) {
    arr[i] = 0;
  }
  for (var i = 0; i < this.bits_.length; i++) {
    for (var j = 0; j < other.bits_.length; j++) {
      var a1 = this.getBits(i) >>> 16;
      var a0 = this.getBits(i) & 0xFFFF;

      var b1 = other.getBits(j) >>> 16;
      var b0 = other.getBits(j) & 0xFFFF;

      arr[2 * i + 2 * j] += a0 * b0;
      Integer.carry16_(arr, 2 * i + 2 * j);
      arr[2 * i + 2 * j + 1] += a1 * b0;
      Integer.carry16_(arr, 2 * i + 2 * j + 1);
      arr[2 * i + 2 * j + 1] += a0 * b1;
      Integer.carry16_(arr, 2 * i + 2 * j + 1);
      arr[2 * i + 2 * j + 2] += a1 * b1;
      Integer.carry16_(arr, 2 * i + 2 * j + 2);
    }
  }

  // Combine the 16-bit values into 32-bit values.
  for (var i = 0; i < len; i++) {
    arr[i] = (arr[2 * i + 1] << 16) | arr[2 * i];
  }
  for (var i = len; i < 2 * len; i++) {
    arr[i] = 0;
  }
  return new Integer(arr, 0);
};


/**
 * Carries any overflow from the given index into later entries.
 * @param {Array<number>} bits Array of 16-bit values in little-endian order.
 * @param {number} index The index in question.
 * @private
 */
Integer.carry16_ = function(bits, index) {
  'use strict';
  while ((bits[index] & 0xFFFF) != bits[index]) {
    bits[index + 1] += bits[index] >>> 16;
    bits[index] &= 0xFFFF;
    index++;
  }
};


/**
 * Returns "this" Integer divided by the given one. Both "this" and the given
 * Integer MUST be positive.
 *
 * This method is only needed for very large numbers (>10^308),
 * for which the original division algorithm gets into an infinite
 * loop (see https://github.com/google/closure-library/issues/500).
 *
 * The algorithm has some possible performance enhancements (or
 * could be rewritten entirely), it's just an initial solution for
 * the issue linked above.
 *
 * @param {!Integer} other The Integer to divide "this" by.
 * @return {!Integer.DivisionResult}
 * @private
 */
Integer.prototype.slowDivide_ = function(other) {
  'use strict';
  if (this.isNegative() || other.isNegative()) {
    throw new Error('slowDivide_ only works with positive integers.');
  }

  var twoPower = Integer.ONE;
  var multiple = other;

  // First we have to figure out what the highest bit of the result
  // is, so we increase "twoPower" and "multiple" until "multiple"
  // exceeds "this".
  while (multiple.lessThanOrEqual(this)) {
    twoPower = twoPower.shiftLeft(1);
    multiple = multiple.shiftLeft(1);
  }

  // Rewind by one power of two, giving us the highest bit of the
  // result.
  var res = twoPower.shiftRight(1);
  var total = multiple.shiftRight(1);

  // Now we starting decreasing "multiple" and "twoPower" to find the
  // rest of the bits of the result.
  var total2;
  multiple = multiple.shiftRight(2);
  twoPower = twoPower.shiftRight(2);
  while (!multiple.isZero()) {
    // whenever we can add "multiple" to the total and not exceed
    // "this", that means we've found a 1 bit. Else we've found a 0
    // and don't need to add to the result.
    total2 = total.add(multiple);
    if (total2.lessThanOrEqual(this)) {
      res = res.add(twoPower);
      total = total2;
    }
    multiple = multiple.shiftRight(1);
    twoPower = twoPower.shiftRight(1);
  }


  // TODO(user): Calculate this more efficiently during the division.
  // This is kind of a waste since it isn't always needed, but it keeps the
  // API smooth. Since this is already a slow path it probably isn't a big deal.
  var remainder = this.subtract(res.multiply(other));
  return new Integer.DivisionResult(res, remainder);
};


/**
 * Returns this Integer divided by the given one.
 * @param {!Integer} other The Integer to divide this by.
 * @return {!Integer} This value divided by the given one.
 */
Integer.prototype.divide = function(other) {
  'use strict';
  return this.divideAndRemainder(other).quotient;
};


/**
 * A struct for holding the quotient and remainder of a division.
 *
 * @constructor
 * @final
 * @struct
 *
 * @param {!Integer} quotient
 * @param {!Integer} remainder
 */
Integer.DivisionResult = function(quotient, remainder) {
  'use strict';
  /** @const */
  this.quotient = quotient;

  /** @const */
  this.remainder = remainder;
};


/**
 * Returns this Integer divided by the given one, as well as the remainder of
 * that division.
 *
 * @param {!Integer} other The Integer to divide this by.
 * @return {!Integer.DivisionResult}
 */
Integer.prototype.divideAndRemainder = function(other) {
  'use strict';
  if (other.isZero()) {
    throw new Error('division by zero');
  } else if (this.isZero()) {
    return new Integer.DivisionResult(
        Integer.ZERO, Integer.ZERO);
  }

  if (this.isNegative()) {
    // Do the division on the negative of the numerator...
    var result = this.negate().divideAndRemainder(other);
    return new Integer.DivisionResult(
        // ...and flip the sign back after.
        result.quotient.negate(),
        // The remainder must always have the same sign as the numerator.
        result.remainder.negate());
  } else if (other.isNegative()) {
    // Do the division on the negative of the denominator...
    var result = this.divideAndRemainder(other.negate());
    return new Integer.DivisionResult(
        // ...and flip the sign back after.
        result.quotient.negate(),
        // The remainder must always have the same sign as the numerator.
        result.remainder);
  }

  // Have to degrade to slowDivide for Very Large Numbers, because
  // they're out of range for the floating-point approximation
  // technique used below.
  if (this.bits_.length > 30) {
    return this.slowDivide_(other);
  }

  // Repeat the following until the remainder is less than other:  find a
  // floating-point that approximates remainder / other *from below*, add this
  // into the result, and subtract it from the remainder.  It is critical that
  // the approximate value is less than or equal to the real value so that the
  // remainder never becomes negative.
  var res = Integer.ZERO;
  var rem = this;
  while (rem.greaterThanOrEqual(other)) {
    // Approximate the result of division. This may be a little greater or
    // smaller than the actual value.
    var approx = Math.max(1, Math.floor(rem.toNumber() / other.toNumber()));

    // We will tweak the approximate result by changing it in the 48-th digit or
    // the smallest non-fractional digit, whichever is larger.
    var log2 = Math.ceil(Math.log(approx) / Math.LN2);
    var delta = (log2 <= 48) ? 1 : Math.pow(2, log2 - 48);

    // Decrease the approximation until it is smaller than the remainder.  Note
    // that if it is too large, the product overflows and is negative.
    var approxRes = Integer.fromNumber(approx);
    var approxRem = approxRes.multiply(other);
    while (approxRem.isNegative() || approxRem.greaterThan(rem)) {
      approx -= delta;
      approxRes = Integer.fromNumber(approx);
      approxRem = approxRes.multiply(other);
    }

    // We know the answer can't be zero... and actually, zero would cause
    // infinite recursion since we would make no progress.
    if (approxRes.isZero()) {
      approxRes = Integer.ONE;
    }

    res = res.add(approxRes);
    rem = rem.subtract(approxRem);
  }
  return new Integer.DivisionResult(res, rem);
};


/**
 * Returns this Integer modulo the given one.
 * @param {!Integer} other The Integer by which to mod.
 * @return {!Integer} This value modulo the given one.
 */
Integer.prototype.modulo = function(other) {
  'use strict';
  return this.divideAndRemainder(other).remainder;
};


/** @return {!Integer} The bitwise-NOT of this value. */
Integer.prototype.not = function() {
  'use strict';
  var len = this.bits_.length;
  var arr = [];
  for (var i = 0; i < len; i++) {
    arr[i] = ~this.bits_[i];
  }
  return new Integer(arr, ~this.sign_);
};


/**
 * Returns the bitwise-AND of this Integer and the given one.
 * @param {Integer} other The Integer to AND with this.
 * @return {!Integer} The bitwise-AND of this and the other.
 */
Integer.prototype.and = function(other) {
  'use strict';
  var len = Math.max(this.bits_.length, other.bits_.length);
  var arr = [];
  for (var i = 0; i < len; i++) {
    arr[i] = this.getBits(i) & other.getBits(i);
  }
  return new Integer(arr, this.sign_ & other.sign_);
};


/**
 * Returns the bitwise-OR of this Integer and the given one.
 * @param {Integer} other The Integer to OR with this.
 * @return {!Integer} The bitwise-OR of this and the other.
 */
Integer.prototype.or = function(other) {
  'use strict';
  var len = Math.max(this.bits_.length, other.bits_.length);
  var arr = [];
  for (var i = 0; i < len; i++) {
    arr[i] = this.getBits(i) | other.getBits(i);
  }
  return new Integer(arr, this.sign_ | other.sign_);
};


/**
 * Returns the bitwise-XOR of this Integer and the given one.
 * @param {Integer} other The Integer to XOR with this.
 * @return {!Integer} The bitwise-XOR of this and the other.
 */
Integer.prototype.xor = function(other) {
  'use strict';
  var len = Math.max(this.bits_.length, other.bits_.length);
  var arr = [];
  for (var i = 0; i < len; i++) {
    arr[i] = this.getBits(i) ^ other.getBits(i);
  }
  return new Integer(arr, this.sign_ ^ other.sign_);
};


/**
 * Returns this value with bits shifted to the left by the given amount.
 * @param {number} numBits The number of bits by which to shift.
 * @return {!Integer} This shifted to the left by the given amount.
 */
Integer.prototype.shiftLeft = function(numBits) {
  'use strict';
  var arr_delta = numBits >> 5;
  var bit_delta = numBits % 32;
  var len = this.bits_.length + arr_delta + (bit_delta > 0 ? 1 : 0);
  var arr = [];
  for (var i = 0; i < len; i++) {
    if (bit_delta > 0) {
      arr[i] = (this.getBits(i - arr_delta) << bit_delta) |
          (this.getBits(i - arr_delta - 1) >>> (32 - bit_delta));
    } else {
      arr[i] = this.getBits(i - arr_delta);
    }
  }
  return new Integer(arr, this.sign_);
};


/**
 * Returns this value with bits shifted to the right by the given amount.
 * @param {number} numBits The number of bits by which to shift.
 * @return {!Integer} This shifted to the right by the given amount.
 */
Integer.prototype.shiftRight = function(numBits) {
  'use strict';
  var arr_delta = numBits >> 5;
  var bit_delta = numBits % 32;
  var len = this.bits_.length - arr_delta;
  var arr = [];
  for (var i = 0; i < len; i++) {
    if (bit_delta > 0) {
      arr[i] = (this.getBits(i + arr_delta) >>> bit_delta) |
          (this.getBits(i + arr_delta + 1) << (32 - bit_delta));
    } else {
      arr[i] = this.getBits(i + arr_delta);
    }
  }
  return new Integer(arr, this.sign_);
};

// instances of the Closure Library's own classes, when the compatibility layer
// loaded them, are instances too
for (const [klass, name] of [[Long, 'Long'], [Integer, 'Integer']]) {
  Object.defineProperty(klass, Symbol.hasInstance, {
    value(x) {
      if (Function.prototype[Symbol.hasInstance].call(klass, x)) return true;
      const real = globalThis.goog && globalThis.goog.math && globalThis.goog.math[name];
      return real && real !== klass ? x instanceof real : false;
    },
  });
}

export {Long, Integer};
