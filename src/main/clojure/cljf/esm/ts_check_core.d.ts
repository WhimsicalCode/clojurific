// :ts-check's types of cljs.core and its constants module (cljf.esm.ts-check),
// for ClojureScript values where they reach JavaScript: keywords, symbols and
// the persistent collections are classes TypeScript tells apart from strings,
// numbers and plain objects, so that passing one where a JavaScript API takes
// those fails. Functions whose results are JavaScript values are typed
// (str is a string). Everything else is any, as the rest of the check's
// ClojureScript values are.

// a function, called directly or by the compiler's arity methods
type Arities<R> = { [k: `cljs$core$IFn$_invoke$arity$${string}`]: (...args: any[]) => R };
export type CljsFn<R> = ((...args: any[]) => R) & Arities<R> & { [k: string]: any };

// what the compiler sets and reads on ClojureScript values: protocol methods
// and masks, arity methods. Each class has its statics (EMPTY, fromArray, …),
// which an index signature of this one wouldn't give it.
declare class CljsValue {
  private __cljs: true;
  [k: `cljs$${string}`]: any;
  // collections and keywords called as functions
  call(...args: any[]): any;
  apply(...args: any[]): any;
  // JavaScript methods cljs.core defines on them
  toString(): string;
  equiv(other: any): boolean;
  indexOf(...args: any[]): number;
  lastIndexOf(...args: any[]): number;
}

// collections, which are ES6 iterables (Promise.all takes a vector)
declare class CljsColl extends CljsValue {
  [Symbol.iterator](): Iterator<any>;
}

export declare class Keyword extends CljsValue {
  constructor(...args: any[]);
  static [k: string]: any;
  ns: string | null;
  name: string;
  fqn: string;
}
export declare class CljsSymbol extends CljsValue {
  constructor(...args: any[]);
  static [k: string]: any;
  ns: string | null;
  name: string;
  str: string;
}
export declare class UUID extends CljsValue {
  constructor(...args: any[]);
  static [k: string]: any;
  uuid: string;
}
export declare class PersistentArrayMap extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: PersistentArrayMap;
  static [k: string]: any;
}
export declare class PersistentHashMap extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: PersistentHashMap;
  static [k: string]: any;
}
export declare class PersistentTreeMap extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: PersistentTreeMap;
  static [k: string]: any;
}
export declare class PersistentVector extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: PersistentVector;
  static [k: string]: any;
}
export declare class PersistentHashSet extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: PersistentHashSet;
  static [k: string]: any;
}
export declare class PersistentTreeSet extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: PersistentTreeSet;
  static [k: string]: any;
}
export declare class PersistentQueue extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: PersistentQueue;
  static [k: string]: any;
}
export declare class List extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: List;
  static [k: string]: any;
}
export declare class EmptyList extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: EmptyList;
  static [k: string]: any;
}
export declare class Cons extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: Cons;
  static [k: string]: any;
}
export declare class LazySeq extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: LazySeq;
  static [k: string]: any;
}
export declare class IndexedSeq extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: IndexedSeq;
  static [k: string]: any;
}
export declare class MapEntry extends CljsColl {
  constructor(...args: any[]);
  static EMPTY: MapEntry;
  static [k: string]: any;
}
// ex-info's, an Error
export declare class ExceptionInfo extends Error {
  constructor(...args: any[]);
  data: any;
  cause: any;
  [k: `cljs$${string}`]: any;
}
export declare class Atom extends CljsValue {
  constructor(...args: any[]);
  static EMPTY: Atom;
  static [k: string]: any;
}
export declare class Volatile extends CljsValue {
  constructor(...args: any[]);
  static EMPTY: Volatile;
  static [k: string]: any;
}
export declare class Delay extends CljsValue {
  constructor(...args: any[]);
  static EMPTY: Delay;
  static [k: string]: any;
}
export declare class Var extends CljsValue {
  constructor(...args: any[]);
  static EMPTY: Var;
  static [k: string]: any;
}
export declare class MultiFn extends CljsValue {
  constructor(...args: any[]);
  static EMPTY: MultiFn;
  static [k: string]: any;
}

// what seq functions return (nil for an empty one, which TypeScript doesn't
// check here) and what collection functions return given a collection
type Seq = CljsColl;
type Coll = CljsColl;

export type Core = {
  Keyword: typeof Keyword;
  Symbol: typeof CljsSymbol;
  UUID: typeof UUID;
  PersistentArrayMap: typeof PersistentArrayMap;
  PersistentHashMap: typeof PersistentHashMap;
  PersistentTreeMap: typeof PersistentTreeMap;
  PersistentVector: typeof PersistentVector;
  PersistentHashSet: typeof PersistentHashSet;
  PersistentTreeSet: typeof PersistentTreeSet;
  PersistentQueue: typeof PersistentQueue;
  List: typeof List;
  EmptyList: typeof EmptyList;
  Cons: typeof Cons;
  LazySeq: typeof LazySeq;
  IndexedSeq: typeof IndexedSeq;
  MapEntry: typeof MapEntry;
  Atom: typeof Atom;
  Volatile: typeof Volatile;
  Delay: typeof Delay;
  Var: typeof Var;
  MultiFn: typeof MultiFn;
  ExceptionInfo: typeof ExceptionInfo;

  name: CljsFn<string>;
  namespace: CljsFn<string>;
  str: CljsFn<string>;
  subs: CljsFn<string>;
  pr_str: CljsFn<string>;
  prn_str: CljsFn<string>;
  print_str: CljsFn<string>;
  count: CljsFn<number>;
  bounded_count: CljsFn<number>;
  inc: CljsFn<number>;
  dec: CljsFn<number>;
  compare: CljsFn<number>;
  hash: CljsFn<number>;
  max: CljsFn<number>;
  min: CljsFn<number>;
  abs: CljsFn<number>;
  _PLUS_: CljsFn<number>;
  _: CljsFn<number>;
  _STAR_: CljsFn<number>;
  _SLASH_: CljsFn<number>;
  quot: CljsFn<number>;
  rem: CljsFn<number>;
  mod: CljsFn<number>;
  rand: CljsFn<number>;
  rand_int: CljsFn<number>;
  truth_: CljsFn<boolean>;
  not: CljsFn<boolean>;
  _EQ_: CljsFn<boolean>;
  not_EQ_: CljsFn<boolean>;
  identical_QMARK_: CljsFn<boolean>;
  boolean: CljsFn<boolean>;
  contains_QMARK_: CljsFn<boolean>;
  empty_QMARK_: CljsFn<boolean>;
  every_QMARK_: CljsFn<boolean>;
  not_any_QMARK_: CljsFn<boolean>;
  not_every_QMARK_: CljsFn<boolean>;
  nil_QMARK_: CljsFn<boolean>;
  some_QMARK_: CljsFn<boolean>;
  true_QMARK_: CljsFn<boolean>;
  false_QMARK_: CljsFn<boolean>;
  string_QMARK_: CljsFn<boolean>;
  number_QMARK_: CljsFn<boolean>;
  integer_QMARK_: CljsFn<boolean>;
  boolean_QMARK_: CljsFn<boolean>;
  keyword_QMARK_: CljsFn<boolean>;
  symbol_QMARK_: CljsFn<boolean>;
  uuid_QMARK_: CljsFn<boolean>;
  fn_QMARK_: CljsFn<boolean>;
  ifn_QMARK_: CljsFn<boolean>;
  coll_QMARK_: CljsFn<boolean>;
  map_QMARK_: CljsFn<boolean>;
  vector_QMARK_: CljsFn<boolean>;
  set_QMARK_: CljsFn<boolean>;
  seq_QMARK_: CljsFn<boolean>;
  sequential_QMARK_: CljsFn<boolean>;
  chunked_seq_QMARK_: CljsFn<boolean>;
  zero_QMARK_: CljsFn<boolean>;
  pos_QMARK_: CljsFn<boolean>;
  neg_QMARK_: CljsFn<boolean>;
  even_QMARK_: CljsFn<boolean>;
  odd_QMARK_: CljsFn<boolean>;
  distinct_QMARK_: CljsFn<boolean>;
  keyword: CljsFn<Keyword>;
  symbol: CljsFn<CljsSymbol>;
  gensym: CljsFn<CljsSymbol>;
  uuid: CljsFn<UUID>;
  random_uuid: CljsFn<UUID>;
  vector: CljsFn<PersistentVector>;
  vec: CljsFn<PersistentVector>;
  mapv: CljsFn<PersistentVector>;
  filterv: CljsFn<PersistentVector>;
  subvec: CljsFn<PersistentVector>;
  hash_map: CljsFn<PersistentHashMap>;
  array_map: CljsFn<PersistentArrayMap>;
  hash_set: CljsFn<PersistentHashSet>;
  set: CljsFn<PersistentHashSet>;
  list: CljsFn<List>;
  atom: CljsFn<Atom>;
  volatile_BANG_: CljsFn<Volatile>;
  seq: CljsFn<Seq>;
  rest: CljsFn<Seq>;
  next: CljsFn<Seq>;
  cons: CljsFn<Seq>;
  keys: CljsFn<Seq>;
  vals: CljsFn<Seq>;
  map: CljsFn<Seq>;
  filter: CljsFn<Seq>;
  remove: CljsFn<Seq>;
  keep: CljsFn<Seq>;
  mapcat: CljsFn<Seq>;
  concat: CljsFn<Seq>;
  map_indexed: CljsFn<Seq>;
  range: CljsFn<Seq>;
  take: CljsFn<Seq>;
  drop: CljsFn<Seq>;
  take_while: CljsFn<Seq>;
  drop_while: CljsFn<Seq>;
  sort: CljsFn<Seq>;
  sort_by: CljsFn<Seq>;
  distinct: CljsFn<Seq>;
  reverse: CljsFn<Seq>;
  partition: CljsFn<Seq>;
  partition_all: CljsFn<Seq>;
  interleave: CljsFn<Seq>;
  interpose: CljsFn<Seq>;
  into: CljsFn<Coll>;
  conj: CljsFn<Coll>;
  assoc: CljsFn<Coll>;
  dissoc: CljsFn<Coll>;
  merge: CljsFn<Coll>;
  merge_with: CljsFn<Coll>;
  update: CljsFn<Coll>;
  assoc_in: CljsFn<Coll>;
  update_in: CljsFn<Coll>;
  select_keys: CljsFn<Coll>;
  zipmap: CljsFn<Coll>;
  group_by: CljsFn<Coll>;
  frequencies: CljsFn<Coll>;
  not_empty: CljsFn<Coll>;
  ex_info: CljsFn<ExceptionInfo>;
  [k: string]: any;
};

// cljs.core.constants of :optimize-constants: cst$kw$… and cst$sym$…
export type Constants = {
  [k: `cst$kw$${string}`]: Keyword;
  [k: `cst$sym$${string}`]: CljsSymbol;
  [k: string]: any;
};
