// The subset of goog.string in string.js.

export function startsWith(str: string, prefix: string): boolean;
export function endsWith(str: string, suffix: string): boolean;
/** Whether str is empty or only whitespace. */
export function isEmptyOrWhitespace(str: string): boolean;
export const isEmpty: typeof isEmptyOrWhitespace;
export function isEmptyString(str: string): boolean;
/** Whether str only has the digits 0-9. */
export function isNumeric(str: string): boolean;
export function isUnicodeChar(ch: string): boolean;
export function contains(str: string, subString: string): boolean;
export function trim(str: string): string;
export function trimLeft(str: string): string;
export function trimRight(str: string): string;
/** str with its first character upper case and the rest lower case. */
export function capitalize(str: string): string;
/** s with the characters a regular expression gives meaning escaped. */
export function regExpEscape(s: unknown): string;
/** obj as a string, '' for null and undefined. */
export function makeSafe(obj: unknown): string;
/** Java's String.hashCode, as an unsigned 32-bit number. */
export function hashCode(str: string): number;

export class StringBuffer {
  /** A buffer holding its arguments as strings. */
  constructor(opt_a1?: unknown, ...var_args: unknown[]);
  /** Replaces the buffer's content with s. */
  set(s: unknown): void;
  append(a1: unknown, ...var_args: unknown[]): this;
  clear(): void;
  getLength(): number;
  toString(): string;
}

export function repeat(string: string, length: number): string;
/** sprintf-style formatting of %s, %f, %d, %i and %u with flags, width and precision. */
export function format(formatString: string, ...var_args: unknown[]): string;
/** num padded with leading zeros to length digits before the decimal point. */
export function padNumber(num: number, length: number, opt_precision?: number): string;
export function htmlEscape(str: string, opt_isLikelyToContainHtmlChars?: boolean): string;
/** str with its HTML entities decoded. */
export function unescapeEntities(str: string): string;
