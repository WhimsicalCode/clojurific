// The subset of goog.object in object.js.

/** obj[key] when obj has it, own or inherited, otherwise val. */
export function get(obj: object | null, key: PropertyKey, val?: unknown): any;
export function set(obj: object, key: PropertyKey, value: unknown): void;
export function containsKey(obj: object | null, key: PropertyKey): boolean;
/** The keys for-in visits. */
export function getKeys(obj: object): string[];
/** The values for-in visits. */
export function getValues(obj: object): any[];
export function forEach<O extends object, S = undefined>(obj: O, f: (this: S, value: any, key: string, obj: O) => unknown, opt_obj?: S): void;
/** Whether a and b have the same keys with identical values. */
export function equals(a: object, b: object): boolean;
/** A shallow copy of the keys for-in visits. */
export function clone<T extends object>(obj: T): T;
/** An object of alternating keys and values, or an array of them. */
export function create(...var_args: unknown[]): Record<string, any>;
/** obj[k1][k2]..., undefined once a step is null or undefined; the keys are arguments or an array. */
export function getValueByKeys(obj: unknown, ...var_args: unknown[]): any;
/** Copies the properties of each source into target. */
export function extend(target: object, ...var_args: Array<object | null | undefined>): void;
