// The subset of the Closure Library's base.js in goog.js.

import type { Uri as GoogUri } from './goog/Uri.js';

export let global: typeof globalThis;

/** typeof, with 'null' for null and 'array' for arrays. */
export function typeOf(value: unknown): 'array' | 'bigint' | 'boolean' | 'function' | 'null' | 'number' | 'object' | 'string' | 'symbol' | 'undefined';
/** Whether value is an array, or an object with a numeric length. */
export function isArrayLike(val: unknown): val is ArrayLike<any>;
/** Whether value is an object or a function, not null. */
export function isObject(val: unknown): val is object;
export function isNumber(val: unknown): val is number;
/** fn bound to selfObj, with the arguments after it prepended. */
export function bind<T extends (...args: any[]) => any>(fn: T, selfObj: unknown, ...var_args: any[]): (...args: any[]) => ReturnType<T>;
/** A unique id of obj, stable across calls. */
export function getUid(obj: object): number;
/** The value of a :closure-defines name, CLOSURE_DEFINES' at runtime or defaultValue. */
export function define<T>(name: string, defaultValue: T): T;
export const DEBUG: boolean;
/** instanceof the goog.Uri shim's class (goog/Uri.js), or the Closure Library's. */
export const Uri: { [Symbol.hasInstance](x: unknown): x is GoogUri };
/** Makes value reachable as a global at the dotted path, i.e. my.app.init. */
export function exportSymbol(path: string, value: unknown): void;
/** Throws: ES module output has no Node.js global require. */
export function nodeGlobalRequire(path: string): never;
