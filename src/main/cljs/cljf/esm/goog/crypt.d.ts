// goog.crypt and goog.crypt.Sha256, see crypt.js.

/** str's char codes, which must be bytes in debug builds (or with throwSync). */
export function stringToByteArray(str: string, throwSync?: boolean): number[];
export function binaryStringToByteArray(str: string): number[];
/** A string of bytes' char codes. */
export function byteArrayToBinaryString(bytes: ArrayLike<number>): string;
export const byteArrayToString: typeof byteArrayToBinaryString;
export function byteArrayToHex(array: ArrayLike<number>, opt_separator?: string): string;
export function hexToByteArray(hexString: string): number[];
/** str's UTF-8 bytes. */
export function textToByteArray(str: string): number[];
export const stringToUtf8ByteArray: typeof textToByteArray;
/** The string UTF-8 bytes encode. */
export function byteArrayToText(bytes: ArrayLike<number>): string;
export const utf8ByteArrayToString: typeof byteArrayToText;
export function xorByteArray(bytes1: ArrayLike<number>, bytes2: ArrayLike<number>): number[];

/** SHA-256. */
export class Sha256 {
  constructor();
  readonly blockSize: number;
  reset(): void;
  /** Adds a byte array, or a string of bytes, or its first opt_length. */
  update(message: ArrayLike<number> | string, opt_length?: number): void;
  /** The hash's bytes. */
  digest(): number[];
}
