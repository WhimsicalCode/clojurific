// The subset of goog.events in events.js, over addEventListener.

/** A Closure Library event target (goog.net.XhrIo), which listens itself. */
export interface Listenable {
  listen(...args: any[]): any;
  unlistenByKey(key: any): boolean;
}
/** An event target: a DOM one, a MediaQueryList or a Listenable. */
export type EventSource = EventTarget | MediaQueryList | Listenable;
export type Listener<S = any> = ((this: S, e: BrowserEvent) => unknown) | { handleEvent(e: BrowserEvent): unknown };
/** A listen's capture flag, or addEventListener's options. */
export type ListenOptions = boolean | AddEventListenerOptions;
/** What listen returns, for unlistenByKey. */
export interface Key {
  readonly src: EventSource;
  readonly type: string;
  readonly capture: boolean;
  readonly removed: boolean;
}

// only what's exported: a .d.ts module without export {} exports every declaration
export {};

/** goog.events.Event's members: a native event's, with the target it was listened on as currentTarget. */
declare class Event {
  constructor(type: string, opt_target?: unknown);
  type: string;
  target: any;
  currentTarget: any;
  defaultPrevented: boolean;
  hasPropagationStopped(): boolean;
  stopPropagation(): void;
  preventDefault(): void;
}

/** A native event, as listeners get it. */
export class BrowserEvent extends Event {
  constructor(opt_e?: globalThis.Event, opt_currentTarget?: unknown);
  relatedTarget: any;
  offsetX: number;
  offsetY: number;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  button: number;
  key: string;
  keyCode: number;
  charCode: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  /** A popstate event's state. */
  state: any;
  /** metaKey on macOS, ctrlKey elsewhere. */
  platformModifierKey: boolean;
  pointerId: number;
  pointerType: string;
  init(e: globalThis.Event, opt_currentTarget?: unknown): void;
  isButton(button: BrowserEvent.MouseButton): boolean;
  /** Whether the primary button was pressed, without ctrl on macOS. */
  isMouseActionButton(): boolean;
  getBrowserEvent(): globalThis.Event;
}

export namespace BrowserEvent {
  type MouseButton = 0 | 1 | 2 | 3 | 4;
  const MouseButton: { readonly LEFT: 0; readonly MIDDLE: 1; readonly RIGHT: 2; readonly BACK: 3; readonly FORWARD: 4 };
  type PointerType = 'mouse' | 'pen' | 'touch';
  const PointerType: { readonly MOUSE: 'mouse'; readonly PEN: 'pen'; readonly TOUCH: 'touch' };
}

/** listener, or a function calling an object listener's handleEvent. */
export function wrapListener(listener: Listener): (e: BrowserEvent) => unknown;
/** Listens to type (or each of an array's) on src; null for an array. */
export function listen<S = any>(src: EventSource, type: string | string[], listener: Listener<S>, opt_options?: ListenOptions, opt_handler?: S): Key | null;
/** listen, unlistening after the first event. */
export function listenOnce<S = any>(src: EventSource, type: string | string[], listener: Listener<S>, opt_options?: ListenOptions, opt_handler?: S): Key | null;
/** Removes the listener listen returned key for, returning whether there was one. */
export function unlistenByKey(key: Key | number | null): boolean;
export function unlisten<S = any>(src: EventSource, type: string | string[], listener: Listener<S>, opt_options?: ListenOptions, opt_handler?: S): boolean | null;
export function getListener<S = any>(src: EventSource | null, type: string, listener: Listener<S>, opt_capt?: boolean, opt_handler?: S): Key | null;
export function getListeners(obj: EventSource | null, type: string, capture: boolean): Key[];
export function hasListener(obj: EventSource | null, opt_type?: string, opt_capture?: boolean): boolean;
/** Removes obj's listeners, of opt_type only if given, returning how many. */
export function removeAll(obj: EventSource | null, opt_type?: string): number;
