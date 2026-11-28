// The subset of goog.i18n.uChar in uChar.js.

export function isSupplementaryCodePoint(codePoint: number): boolean;
export function isLeadSurrogateCodePoint(codePoint: number): boolean;
export function isTrailSurrogateCodePoint(codePoint: number): boolean;
/** The code point of a surrogate pair, null if they aren't one. */
export function buildSupplementaryCodePoint(lead: number, trail: number): number | null;
/** How many UTF-16 code units codePoint takes. */
export function charCount(codePoint: number): 1 | 2;
/** The code point at index, negative when index is a surrogate pair's trail. */
export function getCodePointAround(string: string, index: number): number;
export function toCharCode(ch: string): number;
/** The string of a code point, null if it isn't one. */
export function fromCharCode(code: number | null | undefined): string | null;
