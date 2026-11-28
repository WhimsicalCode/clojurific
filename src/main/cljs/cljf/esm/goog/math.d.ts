// goog.math.Long and goog.math.Integer, see math.js. Long's declarations are
// tsc's of math.js, Integer's are written from its JSDoc.

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
 */
export class Long {
  /**
   * @param low  The low (signed) 32 bits of the long.
   * @param high  The high (signed) 32 bits of the long.
   */
  constructor(low: number, high: number);
  /** @returns The value, assuming it is a 32-bit integer. */
  toInt(): number;
  /**
   * @returns The closest floating-point representation to this value.
   */
  toNumber(): number;
  /**
   * @returns if can be exactly represented using number (i.e.
   *   abs(value) < 2^53).
   */
  isSafeInteger(): boolean;
  /**
   * @param opt_radix The radix in which the text should be written.
   * @returns The textual representation of this value.
   */
  toString(opt_radix?: number ): string;
  /**
   * @param opt_radix The radix in which the text should be written.
   * @returns The unsigned textual representation of this value.
   */
  toUnsignedString(opt_radix?: number ): string;
  /** @returns The high 32-bits as a signed value. */
  getHighBits(): number;
  /** @returns The low 32-bits as a signed value. */
  getLowBits(): number;
  /** @returns The low 32-bits as an unsigned value. */
  getLowBitsUnsigned(): number;
  /**
   * @returns Returns the number of bits needed to represent the
   *   absolute value of this Long.
   */
  getNumBitsAbs(): number;
  /** @returns Whether this value is zero. */
  isZero(): boolean;
  /** @returns Whether this value is negative. */
  isNegative(): boolean;
  /** @returns Whether this value is odd. */
  isOdd(): boolean;
  /**
   * Returns a hash code for this long object that similar java.lang.Long one.
   *
   * @returns 32 bit hash code for this object.
   */
  hashCode(): number;
  /**
   * @param other Long to compare against.
   * @returns Whether this Long equals the other.
   */
  equals(other: Long): boolean;
  /**
   * @param other Long to compare against.
   * @returns Whether this Long does not equal the other.
   */
  notEquals(other: Long): boolean;
  /**
   * @param other Long to compare against.
   * @returns Whether this Long is less than the other.
   */
  lessThan(other: Long): boolean;
  /**
   * @param other Long to compare against.
   * @returns Whether this Long is less than or equal to the other.
   */
  lessThanOrEqual(other: Long): boolean;
  /**
   * @param other Long to compare against.
   * @returns Whether this Long is greater than the other.
   */
  greaterThan(other: Long): boolean;
  /**
   * @param other Long to compare against.
   * @returns Whether this Long is greater than or equal to the other.
   */
  greaterThanOrEqual(other: Long): boolean;
  /**
   * Compares this Long with the given one.
   * @param other Long to compare against.
   * @returns 0 if they are the same, 1 if the this is greater, and -1
   *   if the given one is greater.
   */
  compare(other: Long): number;
  /** @returns The negation of this value. */
  negate(): Long;
  /**
   * Returns the sum of this and the given Long.
   * @param other Long to add to this one.
   * @returns The sum of this and the given Long.
   */
  add(other: Long): Long;
  /**
   * Returns the difference of this and the given Long.
   * @param other Long to subtract from this.
   * @returns The difference of this and the given Long.
   */
  subtract(other: Long): Long;
  /**
   * Returns the product of this and the given long.
   * @param other Long to multiply with this.
   * @returns The product of this and the other.
   */
  multiply(other: Long): Long;
  /**
   * Returns this Long divided by the given one.
   * @param other Long by which to divide.
   * @returns This Long divided by the given one.
   */
  div(other: Long): Long;
  /**
   * Returns this Long modulo the given one.
   * @param other Long by which to mod.
   * @returns This Long modulo the given one.
   */
  modulo(other: Long): Long;
  /** @returns The bitwise-NOT of this value. */
  not(): Long;
  /**
   * Returns the bitwise-AND of this Long and the given one.
   * @param other The Long with which to AND.
   * @returns The bitwise-AND of this and the other.
   */
  and(other: Long): Long;
  /**
   * Returns the bitwise-OR of this Long and the given one.
   * @param other The Long with which to OR.
   * @returns The bitwise-OR of this and the other.
   */
  or(other: Long): Long;
  /**
   * Returns the bitwise-XOR of this Long and the given one.
   * @param other The Long with which to XOR.
   * @returns The bitwise-XOR of this and the other.
   */
  xor(other: Long): Long;
  /**
   * Returns this Long with bits shifted to the left by the given amount.
   * @param numBits The number of bits by which to shift.
   * @returns This shifted to the left by the given amount.
   */
  shiftLeft(numBits: number): Long;
  /**
   * Returns this Long with bits shifted to the right by the given amount.
   * The new leading bits match the current sign bit.
   * @param numBits The number of bits by which to shift.
   * @returns This shifted to the right by the given amount.
   */
  shiftRight(numBits: number): Long;
  /**
   * Returns this Long with bits shifted to the right by the given amount, with
   * zeros placed into the new leading bits.
   * @param numBits The number of bits by which to shift.
   * @returns This shifted to the right by the given amount,
   *   with zeros placed into the new leading bits.
   */
  shiftRightUnsigned(numBits: number): Long;
  /**
   * Returns a Long representing the given (32-bit) integer value.
   * @param value The 32-bit integer in question.
   * @returns The corresponding Long value.
   */
  static fromInt(value: number): Long;
  /**
   * Returns a Long representing the given value.
   * NaN will be returned as zero. Infinity is converted to max value and
   * -Infinity to min value.
   * @param value The number in question.
   * @returns The corresponding Long value.
   */
  static fromNumber(value: number): Long;
  /**
   * Returns a Long representing the 64-bit integer that comes by concatenating
   * the given high and low bits.  Each is assumed to use 32 bits.
   * @param lowBits The low 32-bits.
   * @param highBits The high 32-bits.
   * @returns The corresponding Long value.
   */
  static fromBits(lowBits: number, highBits: number): Long;
  /**
   * Returns a Long representation of the given string, written using the given
   * radix.
   * @param str The textual representation of the Long.
   * @param opt_radix The radix in which the text is written.
   * @returns The corresponding Long value.
   */
  static fromString(str: string, opt_radix?: number ): Long;
  /**
   * Returns the boolean value of whether the input string is within a Long's
   * range. Assumes an input string containing only numeric characters with an
   * optional preceding '-'.
   * @param str The textual representation of the Long.
   * @param opt_radix The radix in which the text is written.
   * @returns Whether the string is within the range of a Long.
   */
  static isStringInRange(str: string, opt_radix?: number ): boolean;
  /**
   * @returns
   * @public
   */
  static getZero(): Long;
  /**
   * @returns
   * @public
   */
  static getOne(): Long;
  /**
   * @returns
   * @public
   */
  static getNegOne(): Long;
  /**
   * @returns
   * @public
   */
  static getMaxValue(): Long;
  /**
   * @returns
   * @public
   */
  static getMinValue(): Long;
  /**
   * @returns
   * @public
   */
  static getTwoPwr24(): Long;
}

/**
 * An arbitrary precision integer, given its 32-bit pieces in little-endian
 * order and its sign: -1 for negative, 0 for positive.
 */
export class Integer {
  constructor(bits: Array<number>, sign: number);
  static fromInt(value: number): Integer;
  static fromNumber(value: number): Integer;
  static fromBits(bits: Array<number>): Integer;
  static fromString(str: string, opt_radix?: number): Integer;
  static readonly ZERO: Integer;
  static readonly ONE: Integer;
  /** @returns The value, assuming it is a 32-bit integer. */
  toInt(): number;
  /** @returns The closest floating-point representation to this value. */
  toNumber(): number;
  toString(opt_radix?: number): string;
  /** @returns The index-th 32-bit piece, little-endian, as a signed number. */
  getBits(index: number): number;
  /** @returns The index-th 32-bit piece, little-endian, as an unsigned number. */
  getBitsUnsigned(index: number): number;
  /** @returns The sign bit of this number, -1 or 0. */
  getSign(): number;
  isZero(): boolean;
  isNegative(): boolean;
  isOdd(): boolean;
  equals(other: Integer): boolean;
  notEquals(other: Integer): boolean;
  greaterThan(other: Integer): boolean;
  greaterThanOrEqual(other: Integer): boolean;
  lessThan(other: Integer): boolean;
  lessThanOrEqual(other: Integer): boolean;
  /** @returns 0 if equal, -1 if this is less than other, 1 if greater. */
  compare(other: Integer): number;
  /** @returns The first numBits bits of this value, sign extended from the final bit. */
  shorten(numBits: number): Integer;
  negate(): Integer;
  abs(): Integer;
  add(other: Integer): Integer;
  subtract(other: Integer): Integer;
  multiply(other: Integer): Integer;
  divide(other: Integer): Integer;
  divideAndRemainder(other: Integer): Integer.DivisionResult;
  modulo(other: Integer): Integer;
  not(): Integer;
  and(other: Integer): Integer;
  or(other: Integer): Integer;
  xor(other: Integer): Integer;
  shiftLeft(numBits: number): Integer;
  shiftRight(numBits: number): Integer;
}

export namespace Integer {
  /** The quotient and remainder of a division. */
  class DivisionResult {
    constructor(quotient: Integer, remainder: Integer);
    quotient: Integer;
    remainder: Integer;
  }
}
