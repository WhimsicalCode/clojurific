// The subset of goog.array in array.js.

/** 1, -1 or 0 by > and <. */
export function defaultCompare(a: any, b: any): number;
export function toArray<T>(object: ArrayLike<T>): T[];
export const clone: typeof toArray;
/** Shuffles arr in place. */
export function shuffle(arr: unknown[], opt_randFn?: () => number): void;
/** Sorts arr in place, keeping equal elements' order. */
export function stableSort<T>(arr: T[], opt_compareFn?: (a: T, b: T) => number): void;
export function isEmpty(arr: ArrayLike<unknown>): boolean;
export function splice<T>(arr: T[], index: number | undefined, howMany: number, ...var_args: T[]): T[];
/** Inserts elementsToAdd into arr at opt_i. */
export function insertArrayAt<T>(arr: T[], elementsToAdd: Iterable<T>, opt_i?: number): void;
/** Removes arr's element at i, returning whether there was one. */
export function removeAt(arr: ArrayLike<unknown>, i: number): boolean;
/** Sorts arr in place, with defaultCompare by default. */
export function sort<T>(arr: T[], opt_compareFn?: (a: T, b: T) => number): void;
