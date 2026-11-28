// goog.crypt.base64, see base64.js.

export const ENCODED_VALS: string;
export const ENCODED_VALS_WEBSAFE: string;
export type Alphabet = 0 | 1 | 2 | 3 | 4;
export const Alphabet: {
  readonly DEFAULT: 0;
  readonly NO_PADDING: 1;
  readonly WEBSAFE: 2;
  readonly WEBSAFE_DOT_PADDING: 3;
  readonly WEBSAFE_NO_PADDING: 4;
};

export function encodeByteArray(input: ArrayLike<number>, alphabet?: Alphabet): string;
/** Encodes a string of bytes. */
export function encodeString(input: string, alphabet?: Alphabet, throwSync?: boolean): string;
export function encodeBinaryString(input: string, alphabet?: Alphabet): string;
/** Encodes a string's UTF-8 bytes. */
export function encodeText(input: string, alphabet?: Alphabet): string;
export const encodeStringUtf8: typeof encodeText;
/** Decodes to a string of bytes. */
export function decodeToBinaryString(input: string, useCustomDecoder?: boolean): string;
export const decodeString: typeof decodeToBinaryString;
/** Decodes UTF-8 bytes to their string. */
export function decodeToText(input: string, useCustomDecoder?: boolean): string;
export const decodeStringUtf8: typeof decodeToText;
export function decodeStringToByteArray(input: string, opt_ignored?: unknown): number[];
export function decodeStringToUint8Array(input: string): Uint8Array;
