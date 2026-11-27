// Copyright The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The subset of goog.events used by ClojureScript libraries (reitit's
// history), as an ES module, over addEventListener. Listeners get a
// BrowserEvent wrapping the native event, as Closure Library's do.
// Closure Library event targets (goog.events.Listenable, i.e. goog.net.XhrIo)
// listen themselves.

// goog.events.Event
class Event {
  constructor(type, opt_target) {
    this.type = type;
    this.target = opt_target;
    this.currentTarget = this.target;
    this.propagationStopped_ = false;
    this.defaultPrevented = false;
  }

  hasPropagationStopped() {
    return this.propagationStopped_;
  }

  stopPropagation() {
    this.propagationStopped_ = true;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

const isMac = /Mac/.test((globalThis.navigator && globalThis.navigator.platform) || '');

// goog.events.BrowserEvent
export class BrowserEvent extends Event {
  constructor(opt_e, opt_currentTarget) {
    super(opt_e ? opt_e.type : '');
    this.target = null;
    this.currentTarget = null;
    this.relatedTarget = null;
    this.offsetX = 0;
    this.offsetY = 0;
    this.clientX = 0;
    this.clientY = 0;
    this.screenX = 0;
    this.screenY = 0;
    this.button = 0;
    this.key = '';
    this.keyCode = 0;
    this.charCode = 0;
    this.ctrlKey = false;
    this.altKey = false;
    this.shiftKey = false;
    this.metaKey = false;
    this.state = null;
    this.platformModifierKey = false;
    this.pointerId = 0;
    this.pointerType = '';
    this.event_ = null;
    if (opt_e) this.init(opt_e, opt_currentTarget);
  }

  init(e, opt_currentTarget) {
    const type = (this.type = e.type);
    const touch = e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : null;
    this.target = e.target || e.srcElement;
    this.currentTarget = opt_currentTarget;
    let relatedTarget = e.relatedTarget;
    if (!relatedTarget) {
      if (type == 'mouseover') relatedTarget = e.fromElement;
      else if (type == 'mouseout') relatedTarget = e.toElement;
    }
    this.relatedTarget = relatedTarget;
    if (touch) {
      this.clientX = touch.clientX !== undefined ? touch.clientX : touch.pageX;
      this.clientY = touch.clientY !== undefined ? touch.clientY : touch.pageY;
      this.screenX = touch.screenX || 0;
      this.screenY = touch.screenY || 0;
    } else {
      this.offsetX = e.offsetX !== undefined ? e.offsetX : e.layerX;
      this.offsetY = e.offsetY !== undefined ? e.offsetY : e.layerY;
      this.clientX = e.clientX !== undefined ? e.clientX : e.pageX;
      this.clientY = e.clientY !== undefined ? e.clientY : e.pageY;
      this.screenX = e.screenX || 0;
      this.screenY = e.screenY || 0;
    }
    this.button = e.button;
    this.keyCode = e.keyCode || 0;
    this.key = e.key || '';
    this.charCode = e.charCode || (type == 'keypress' ? e.keyCode : 0);
    this.ctrlKey = e.ctrlKey;
    this.altKey = e.altKey;
    this.shiftKey = e.shiftKey;
    this.metaKey = e.metaKey;
    this.platformModifierKey = isMac ? e.metaKey : e.ctrlKey;
    this.pointerId = e.pointerId || 0;
    this.pointerType = typeof e.pointerType === 'string' ? e.pointerType : '';
    this.state = e.state;
    this.event_ = e;
    if (e.defaultPrevented) super.preventDefault();
  }

  isButton(button) {
    return this.event_.button == button;
  }

  isMouseActionButton() {
    return this.isButton(0) && !(isMac && this.ctrlKey);
  }

  stopPropagation() {
    super.stopPropagation();
    this.event_.stopPropagation();
  }

  preventDefault() {
    super.preventDefault();
    this.event_.preventDefault();
  }

  getBrowserEvent() {
    return this.event_;
  }
}

const isListenable = (src) =>
  src != null && typeof src.listen === 'function' && typeof src.unlistenByKey === 'function';

const captureOf = (options) =>
  options !== null && typeof options === 'object' ? !!options.capture : !!options;

// The listeners of each event target, which listening again with the same
// listener, type and capture finds, as Closure Library's ListenerMap
const listenerMaps = new WeakMap();

function listen_(src, type, listener, callOnce, opt_options, opt_handler) {
  if (!type) throw new Error('Invalid event type');
  const capture = captureOf(opt_options);
  type = type.toString();
  let listeners = listenerMaps.get(src);
  if (!listeners) listenerMaps.set(src, (listeners = []));
  const existing = listeners.find((l) =>
    l.type == type && l.listener == listener && l.capture == capture && l.handler == opt_handler);
  if (existing) {
    if (!callOnce) existing.callOnce = false;
    return existing;
  }
  const key = { src, type, listener, capture, handler: opt_handler, callOnce, removed: false, proxy: null };
  key.proxy = (e) => {
    if (key.removed) return true;
    if (key.callOnce) unlistenByKey(key);
    return key.listener.call(key.handler || key.src, new BrowserEvent(e, src));
  };
  listeners.push(key);
  if (src.addEventListener) {
    src.addEventListener(type, key.proxy, opt_options === undefined ? false : opt_options);
  } else if (src.addListener && src.removeListener) {
    // MediaQueryList
    src.addListener(key.proxy);
  } else {
    throw new Error('addEventListener and attachEvent are unavailable.');
  }
  return key;
}

export function listen(src, type, listener, opt_options, opt_handler) {
  if (opt_options && opt_options.once) return listenOnce(src, type, listener, opt_options, opt_handler);
  if (Array.isArray(type)) {
    for (const t of type) listen(src, t, listener, opt_options, opt_handler);
    return null;
  }
  if (isListenable(src)) return src.listen(type, listener, captureOf(opt_options), opt_handler);
  return listen_(src, type, listener, false, opt_options, opt_handler);
}

export function listenOnce(src, type, listener, opt_options, opt_handler) {
  if (Array.isArray(type)) {
    for (const t of type) listenOnce(src, t, listener, opt_options, opt_handler);
    return null;
  }
  if (isListenable(src)) return src.listenOnce(type, listener, captureOf(opt_options), opt_handler);
  return listen_(src, type, listener, true, opt_options, opt_handler);
}

export function unlistenByKey(key) {
  if (typeof key === 'number' || !key || key.removed) return false;
  const src = key.src;
  if (isListenable(src)) return src.unlistenByKey(key);
  if (src.removeEventListener) {
    src.removeEventListener(key.type, key.proxy, key.capture);
  } else if (src.removeListener) {
    src.removeListener(key.proxy);
  }
  key.removed = true;
  const listeners = listenerMaps.get(src);
  if (listeners) {
    const i = listeners.indexOf(key);
    if (i >= 0) listeners.splice(i, 1);
  }
  return true;
}

export function unlisten(src, type, listener, opt_options, opt_handler) {
  if (Array.isArray(type)) {
    for (const t of type) unlisten(src, t, listener, opt_options, opt_handler);
    return null;
  }
  const capture = captureOf(opt_options);
  if (isListenable(src)) return src.unlisten(type, listener, capture, opt_handler);
  if (!src) return false;
  const key = (listenerMaps.get(src) || []).find((l) =>
    l.type == type.toString() && l.listener == listener && l.capture == capture && l.handler == opt_handler);
  return key ? unlistenByKey(key) : false;
}

export function removeAll(obj, opt_type) {
  if (!obj) return 0;
  if (isListenable(obj)) return obj.removeAllListeners(opt_type);
  const typeStr = opt_type && opt_type.toString();
  let count = 0;
  for (const key of (listenerMaps.get(obj) || []).slice()) {
    if ((!typeStr || key.type == typeStr) && unlistenByKey(key)) count++;
  }
  return count;
}
