// Copyright The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// goog.net.XhrIo, goog.net.Cookies, goog.net.EventType, goog.net.ErrorCode,
// goog.net.HttpStatus and goog.net.XmlHttp as an ES module, with the
// goog.events.EventTarget XhrIo extends, mechanically converted from the
// Closure Library sources by running them against a module-local goog. Closure
// Library classes are constructor functions here too, so subclasses and
// protocol extensions use them as they are. goog.net.Jsonp, at the end, is
// written for this module. goog.net.cookies is undefined, as in the Closure
// Library: goog.net.Cookies.getInstance() is the document's.

import { getUid } from '../goog.js';
import { listen, unlisten } from './events.js';
import { trim, isEmptyOrWhitespace } from './string.js';
import { extend } from './object.js';

function assert(condition, opt_message) {
  if (!condition) throw new Error('Assertion failed' + (opt_message ? ': ' + opt_message : ''));
  return condition;
}

// goog.inherits
function inherits(childCtor, parentCtor) {
  childCtor.superClass_ = parentCtor.prototype;
  childCtor.prototype = Object.create(parentCtor.prototype);
  childCtor.prototype.constructor = childCtor;
  childCtor.base = function(me, methodName, ...args) {
    return parentCtor.prototype[methodName].apply(me, args);
  };
}

// goog.Uri's, see goog/Uri.js
const splitRe = /^(?:([^:/?#.]+):)?(?:\/\/(?:([^\\/?#]*)@)?([^\\/?#]*?)(?::([0-9]+))?(?=[\\/?#]|$))?([^?#]+)?(?:\?([^#]*))?(?:#([\s\S]*))?$/;

function getEffectiveScheme(uri) {
  let scheme = uri.match(splitRe)[1] || null;
  if (!scheme && globalThis.self && globalThis.self.location) {
    scheme = globalThis.self.location.protocol.slice(0, -1);
  }
  return scheme ? scheme.toLowerCase() : '';
}

const goog = {
  // goog.provide: the namespace's objects, as Closure Library's
  provide(name) {
    let cur = goog;
    for (const part of name.split('.').slice(1)) cur = cur[part] || (cur[part] = {});
  },
  global: globalThis,
  define: (name, defaultValue) => defaultValue,
  bind: (fn, selfObj, ...args) => fn.bind(selfObj, ...args),
  partial: (fn, ...args) => function(...rest) { return fn.apply(this, args.concat(rest)); },
  inherits,
  scope: (fn) => fn.call(globalThis),
  abstractMethod() {
    throw new Error('unimplemented abstract method');
  },
  getUid,
  dispose(obj) {
    if (obj && typeof obj.dispose == 'function') obj.dispose();
  },
  disposeAll(...args) {
    for (const arg of args) {
      if (arg != null && typeof arg === 'object' && typeof arg.length === 'number') goog.disposeAll(...arg);
      else goog.dispose(arg);
    }
  },
  asserts: { assert },
  array: {
    contains: (arr, obj) => Array.prototype.indexOf.call(arr, obj) >= 0,
    removeAt: (arr, i) => Array.prototype.splice.call(arr, i, 1).length == 1,
    remove(arr, obj) {
      const i = Array.prototype.indexOf.call(arr, obj);
      return i >= 0 && goog.array.removeAt(arr, i);
    },
  },
  object: {
    extend,
    map(obj, f, opt_obj) {
      const res = {};
      for (const key in obj) res[key] = f.call(opt_obj, obj[key], key, obj);
      return res;
    },
    some(obj, f, opt_obj) {
      for (const key in obj) if (f.call(opt_obj, obj[key], key, obj)) return true;
      return false;
    },
  },
  string: {
    trim,
    isEmptyOrWhitespace,
    caseInsensitiveEquals: (str1, str2) => str1.toLowerCase() == str2.toLowerCase(),
    splitLimit(str, separator, limit) {
      const parts = str.split(separator);
      const returnVal = [];
      while (limit > 0 && parts.length) {
        returnVal.push(parts.shift());
        limit--;
      }
      if (parts.length) returnVal.push(parts.join(separator));
      return returnVal;
    },
  },
  // goog.log is off in Closure Library builds without goog.DEBUG logging
  log: { getLogger: () => null, fine() {}, error() {} },
  debug: { entryPointRegistry: { register() {} } },
  json: { hybrid: { parse: (text) => JSON.parse(text) } },
  uri: { utils: { getEffectiveScheme } },
  userAgent: { IE: false },
  Timer: {
    callOnce(listener, opt_delay, opt_handler) {
      const fn = typeof listener === 'function' ? listener.bind(opt_handler) : listener.handleEvent.bind(listener);
      return setTimeout(fn, opt_delay || 0);
    },
    clear: (timerId) => clearTimeout(timerId),
  },
  events: { listen, unlisten },
};

// goog/disposable/idisposable.js

/**
 * @fileoverview Definition of the disposable interface.  A disposable object
 * has a dispose method to to clean up references and resources.
 */


goog.provide('goog.disposable.IDisposable');



/**
 * Interface for a disposable object.  If a instance requires cleanup, it should
 * implement this interface (it may subclass goog.Disposable).
 *
 * Examples of cleanup that can be done in `dispose` method:
 * 1. Remove event listeners.
 * 2. Cancel timers (setTimeout, setInterval, goog.Timer).
 * 3. Call `dispose` on other disposable objects hold by current object.
 * 4. Close connections (e.g. WebSockets).
 *
 * Note that it's not required to delete properties (e.g. DOM nodes) or set them
 * to null as garbage collector will collect them assuming that references to
 * current object will be lost after it is disposed.
 *
 * See also http://go/mdn/JavaScript/Memory_Management.
 *
 * @record
 */
goog.disposable.IDisposable = function() {};


/**
 * Disposes of the object and its resources.
 * @return {void} Nothing.
 */
goog.disposable.IDisposable.prototype.dispose = goog.abstractMethod;


/**
 * @return {boolean} Whether the object has been disposed of.
 */
goog.disposable.IDisposable.prototype.isDisposed = goog.abstractMethod;


// goog/disposable/disposable.js

/**
 * @fileoverview Implements the disposable interface.
 */

goog.provide('goog.Disposable');

/**
 * TODO(user): Remove this require.
 * @suppress {extraRequire}
 */

/**
 * Class that provides the basic implementation for disposable objects. If your
 * class holds references or resources that can't be collected by standard GC,
 * it should extend this class or implement the disposable interface (defined
 * in goog.disposable.IDisposable). See description of
 * goog.disposable.IDisposable for examples of cleanup.
 * @constructor
 * @implements {goog.disposable.IDisposable}
 */
goog.Disposable = function() {
  'use strict';
  /**
   * If monitoring the goog.Disposable instances is enabled, stores the creation
   * stack trace of the Disposable instance.
   * @type {string|undefined}
   */
  this.creationStack;

  if (goog.Disposable.MONITORING_MODE != goog.Disposable.MonitoringMode.OFF) {
    if (goog.Disposable.INCLUDE_STACK_ON_CREATION) {
      this.creationStack = new Error().stack;
    }
    goog.Disposable.instances_[goog.getUid(this)] = this;
  }
  // Support sealing
  this.disposed_ = this.disposed_;
  this.onDisposeCallbacks_ = this.onDisposeCallbacks_;
};


/**
 * @enum {number} Different monitoring modes for Disposable.
 */
goog.Disposable.MonitoringMode = {
  /**
   * No monitoring.
   */
  OFF: 0,
  /**
   * Creating and disposing the goog.Disposable instances is monitored. All
   * disposable objects need to call the `goog.Disposable` base
   * constructor. The PERMANENT mode must be switched on before creating any
   * goog.Disposable instances.
   */
  PERMANENT: 1,
  /**
   * INTERACTIVE mode can be switched on and off on the fly without producing
   * errors. It also doesn't warn if the disposable objects don't call the
   * `goog.Disposable` base constructor.
   */
  INTERACTIVE: 2
};


/**
 * @define {number} The monitoring mode of the goog.Disposable
 *     instances. Default is OFF. Switching on the monitoring is only
 *     recommended for debugging because it has a significant impact on
 *     performance and memory usage. If switched off, the monitoring code
 *     compiles down to 0 bytes.
 */
goog.Disposable.MONITORING_MODE =
    goog.define('goog.Disposable.MONITORING_MODE', 0);


/**
 * @define {boolean} Whether to attach creation stack to each created disposable
 *     instance; This is only relevant for when MonitoringMode != OFF.
 */
goog.Disposable.INCLUDE_STACK_ON_CREATION =
    goog.define('goog.Disposable.INCLUDE_STACK_ON_CREATION', true);


/**
 * Maps the unique ID of every undisposed `goog.Disposable` object to
 * the object itself.
 * @type {!Object<number, !goog.Disposable>}
 * @private
 */
goog.Disposable.instances_ = {};


/**
 * @return {!Array<!goog.Disposable>} All `goog.Disposable` objects that
 *     haven't been disposed of.
 */
goog.Disposable.getUndisposedObjects = function() {
  'use strict';
  var ret = [];
  for (var id in goog.Disposable.instances_) {
    if (goog.Disposable.instances_.hasOwnProperty(id)) {
      ret.push(goog.Disposable.instances_[Number(id)]);
    }
  }
  return ret;
};


/**
 * Clears the registry of undisposed objects but doesn't dispose of them.
 */
goog.Disposable.clearUndisposedObjects = function() {
  'use strict';
  goog.Disposable.instances_ = {};
};


/**
 * Whether the object has been disposed of.
 * @type {boolean}
 * @private
 */
goog.Disposable.prototype.disposed_ = false;


/**
 * Callbacks to invoke when this object is disposed.
 * @type {Array<!Function>}
 * @private
 */
goog.Disposable.prototype.onDisposeCallbacks_;


/**
 * @return {boolean} Whether the object has been disposed of.
 * @override
 */
goog.Disposable.prototype.isDisposed = function() {
  'use strict';
  return this.disposed_;
};


/**
 * @return {boolean} Whether the object has been disposed of.
 * @deprecated Use {@link #isDisposed} instead.
 */
goog.Disposable.prototype.getDisposed = goog.Disposable.prototype.isDisposed;


/**
 * Disposes of the object. If the object hasn't already been disposed of, calls
 * {@link #disposeInternal}. Classes that extend `goog.Disposable` should
 * override {@link #disposeInternal} in order to cleanup references, resources
 * and other disposable objects. Reentrant.
 *
 * @return {void} Nothing.
 * @override
 */
goog.Disposable.prototype.dispose = function() {
  'use strict';
  if (!this.disposed_) {
    // Set disposed_ to true first, in case during the chain of disposal this
    // gets disposed recursively.
    this.disposed_ = true;
    this.disposeInternal();
    if (goog.Disposable.MONITORING_MODE != goog.Disposable.MonitoringMode.OFF) {
      var uid = goog.getUid(this);
      if (goog.Disposable.MONITORING_MODE ==
              goog.Disposable.MonitoringMode.PERMANENT &&
          !goog.Disposable.instances_.hasOwnProperty(uid)) {
        throw new Error(
            this + ' did not call the goog.Disposable base ' +
            'constructor or was disposed of after a clearUndisposedObjects ' +
            'call');
      }
      if (goog.Disposable.MONITORING_MODE !=
              goog.Disposable.MonitoringMode.OFF &&
          this.onDisposeCallbacks_ && this.onDisposeCallbacks_.length > 0) {
        throw new Error(
            this + ' did not empty its onDisposeCallbacks queue. This ' +
            'probably means it overrode dispose() or disposeInternal() ' +
            'without calling the superclass\' method.');
      }
      delete goog.Disposable.instances_[uid];
    }
  }
};


/**
 * Associates a disposable object with this object so that they will be disposed
 * together.
 * @param {goog.disposable.IDisposable} disposable that will be disposed when
 *     this object is disposed.
 */
goog.Disposable.prototype.registerDisposable = function(disposable) {
  'use strict';
  this.addOnDisposeCallback(goog.partial(goog.dispose, disposable));
};


/**
 * Invokes a callback function when this object is disposed. Callbacks are
 * invoked in the order in which they were added. If a callback is added to
 * an already disposed Disposable, it will be called immediately.
 * @param {function(this:T):?} callback The callback function.
 * @param {T=} opt_scope An optional scope to call the callback in.
 * @template T
 */
goog.Disposable.prototype.addOnDisposeCallback = function(callback, opt_scope) {
  'use strict';
  if (this.disposed_) {
    opt_scope !== undefined ? callback.call(opt_scope) : callback();
    return;
  }
  if (!this.onDisposeCallbacks_) {
    this.onDisposeCallbacks_ = [];
  }

  this.onDisposeCallbacks_.push(
      opt_scope !== undefined ? goog.bind(callback, opt_scope) : callback);
};


/**
 * Performs appropriate cleanup. See description of goog.disposable.IDisposable
 * for examples. Classes that extend `goog.Disposable` should override this
 * method. Not reentrant. To avoid calling it twice, it must only be called from
 * the subclass' `disposeInternal` method. Everywhere else the public `dispose`
 * method must be used. For example:
 *
 * <pre>
 * mypackage.MyClass = function() {
 * mypackage.MyClass.base(this, 'constructor');
 *     // Constructor logic specific to MyClass.
 *     ...
 *   };
 *   goog.inherits(mypackage.MyClass, goog.Disposable);
 *
 *   mypackage.MyClass.prototype.disposeInternal = function() {
 *     // Dispose logic specific to MyClass.
 *     ...
 *     // Call superclass's disposeInternal at the end of the subclass's, like
 *     // in C++, to avoid hard-to-catch issues.
 *     mypackage.MyClass.base(this, 'disposeInternal');
 *   };
 * </pre>
 *
 * @protected
 */
goog.Disposable.prototype.disposeInternal = function() {
  'use strict';
  if (this.onDisposeCallbacks_) {
    while (this.onDisposeCallbacks_.length) {
      this.onDisposeCallbacks_.shift()();
    }
  }
};


/**
 * Returns True if we can verify the object is disposed.
 * Calls `isDisposed` on the argument if it supports it.  If obj
 * is not an object with an isDisposed() method, return false.
 * @param {*} obj The object to investigate.
 * @return {boolean} True if we can verify the object is disposed.
 */
goog.Disposable.isDisposed = function(obj) {
  'use strict';
  if (obj && typeof obj.isDisposed == 'function') {
    return obj.isDisposed();
  }
  return false;
};


// goog/events/eventid.js

goog.provide('goog.events.EventId');



/**
 * A templated class that is used when registering for events. Typical usage:
 *
 *    /** @type {goog.events.EventId<MyEventObj>} *\
 *    var myEventId = new goog.events.EventId(
 *        goog.events.getUniqueId(('someEvent'));
 *
 *    // No need to cast or declare here since the compiler knows the
 *    // correct type of 'evt' (MyEventObj).
 *    something.listen(myEventId, function(evt) {});
 *
 * @param {string} eventId
 * @template T
 * @constructor
 * @struct
 * @final
 */
goog.events.EventId = function(eventId) {
  'use strict';
  /** @const */ this.id = eventId;
};


/**
 * @override
 * @return {string}
 */
goog.events.EventId.prototype.toString = function() {
  'use strict';
  return this.id;
};


// goog/events/event.js

/**
 * @fileoverview A base class for event objects.
 */


goog.provide('goog.events.Event');

/**
 * goog.events.Event no longer depends on goog.Disposable. Keep requiring
 * goog.Disposable here to not break projects which assume this dependency.
 * @suppress {extraRequire}
 */


/**
 * A base class for event objects, so that they can support preventDefault and
 * stopPropagation.
 *
 * @param {string|!goog.events.EventId} type Event Type.
 * @param {Object=} opt_target Reference to the object that is the target of
 *     this event. It has to implement the `EventTarget` interface
 *     declared at {@link http://developer.mozilla.org/en/DOM/EventTarget}.
 * @constructor
 */
goog.events.Event = function(type, opt_target) {
  'use strict';
  /**
   * Event type.
   * @type {string}
   */
  this.type = type instanceof goog.events.EventId ? String(type) : type;

  /**
   * TODO(tbreisacher): The type should probably be
   * EventTarget|goog.events.EventTarget.
   *
   * Target of the event.
   * @type {Object|undefined}
   */
  this.target = opt_target;

  /**
   * Object that had the listener attached.
   * @type {Object|undefined}
   */
  this.currentTarget = this.target;

  /**
   * Whether to cancel the event in internal capture/bubble processing for IE.
   * @type {boolean}
   * @private
   */
  this.propagationStopped_ = false;

  /**
   * Whether the default action has been prevented.
   * This is a property to match the W3C specification at
   * {@link http://www.w3.org/TR/DOM-Level-3-Events/
   * #events-event-type-defaultPrevented}.
   * Must be treated as read-only outside the class.
   * @type {boolean}
   */
  this.defaultPrevented = false;
};

/**
 * @return {boolean} true iff internal propagation has been stopped.
 */
goog.events.Event.prototype.hasPropagationStopped = function() {
  'use strict';
  return this.propagationStopped_;
};

/**
 * Stops event propagation.
 * @return {void}
 */
goog.events.Event.prototype.stopPropagation = function() {
  'use strict';
  this.propagationStopped_ = true;
};


/**
 * Prevents the default action, for example a link redirecting to a url.
 * @return {void}
 */
goog.events.Event.prototype.preventDefault = function() {
  'use strict';
  this.defaultPrevented = true;
};


/**
 * Stops the propagation of the event. It is equivalent to
 * `e.stopPropagation()`, but can be used as the callback argument of
 * {@link goog.events.listen} without declaring another function.
 * @param {!goog.events.Event} e An event.
 * @return {void}
 */
goog.events.Event.stopPropagation = function(e) {
  'use strict';
  e.stopPropagation();
};


/**
 * Prevents the default action. It is equivalent to
 * `e.preventDefault()`, but can be used as the callback argument of
 * {@link goog.events.listen} without declaring another function.
 * @param {!goog.events.Event} e An event.
 * @return {void}
 */
goog.events.Event.preventDefault = function(e) {
  'use strict';
  e.preventDefault();
};


// goog/events/listenable.js

/**
 * @fileoverview An interface for a listenable JavaScript object.
 */

goog.provide('goog.events.Listenable');



/**
 * A listenable interface. A listenable is an object with the ability
 * to dispatch/broadcast events to "event listeners" registered via
 * listen/listenOnce.
 *
 * The interface allows for an event propagation mechanism similar
 * to one offered by native browser event targets, such as
 * capture/bubble mechanism, stopping propagation, and preventing
 * default actions. Capture/bubble mechanism depends on the ancestor
 * tree constructed via `#getParentEventTarget`; this tree
 * must be directed acyclic graph. The meaning of default action(s)
 * in preventDefault is specific to a particular use case.
 *
 * Implementations that do not support capture/bubble or can not have
 * a parent listenable can simply not implement any ability to set the
 * parent listenable (and have `#getParentEventTarget` return
 * null).
 *
 * Implementation of this class can be used with or independently from
 * goog.events.
 *
 * Implementation must call `#addImplementation(implClass)`.
 *
 * @interface
 * @see goog.events
 * @see http://www.w3.org/TR/DOM-Level-2-Events/events.html
 */
goog.events.Listenable = function() {};


/**
 * An expando property to indicate that an object implements
 * goog.events.Listenable.
 *
 * See addImplementation/isImplementedBy.
 *
 * @type {string}
 * @const
 */
goog.events.Listenable.IMPLEMENTED_BY_PROP =
    'closure_listenable_' + ((Math.random() * 1e6) | 0);


/**
 * Marks a given class (constructor) as an implementation of
 * Listenable, so that we can query that fact at runtime. The class
 * must have already implemented the interface.
 * @param {function(new:goog.events.Listenable,...)} cls The class constructor.
 *     The corresponding class must have already implemented the interface.
 */
goog.events.Listenable.addImplementation = function(cls) {
  'use strict';
  cls.prototype[goog.events.Listenable.IMPLEMENTED_BY_PROP] = true;
};


/**
 * @param {?Object} obj The object to check.
 * @return {boolean} Whether a given instance implements Listenable. The
 *     class/superclass of the instance must call addImplementation.
 */
goog.events.Listenable.isImplementedBy = function(obj) {
  'use strict';
  return !!(obj && obj[goog.events.Listenable.IMPLEMENTED_BY_PROP]);
};


/**
 * Adds an event listener. A listener can only be added once to an
 * object and if it is added again the key for the listener is
 * returned. Note that if the existing listener is a one-off listener
 * (registered via listenOnce), it will no longer be a one-off
 * listener after a call to listen().
 *
 * @param {string|!goog.events.EventId<EVENTOBJ>} type The event type id.
 * @param {function(this:SCOPE, EVENTOBJ):(boolean|undefined)} listener Callback
 *     method.
 * @param {boolean=} opt_useCapture Whether to fire in capture phase
 *     (defaults to false).
 * @param {SCOPE=} opt_listenerScope Object in whose scope to call the
 *     listener.
 * @return {!goog.events.ListenableKey} Unique key for the listener.
 * @template SCOPE,EVENTOBJ
 */
goog.events.Listenable.prototype.listen = function(
    type, listener, opt_useCapture, opt_listenerScope) {};


/**
 * Adds an event listener that is removed automatically after the
 * listener fired once.
 *
 * If an existing listener already exists, listenOnce will do
 * nothing. In particular, if the listener was previously registered
 * via listen(), listenOnce() will not turn the listener into a
 * one-off listener. Similarly, if there is already an existing
 * one-off listener, listenOnce does not modify the listeners (it is
 * still a once listener).
 *
 * @param {string|!goog.events.EventId<EVENTOBJ>} type The event type id.
 * @param {function(this:SCOPE, EVENTOBJ):(boolean|undefined)} listener Callback
 *     method.
 * @param {boolean=} opt_useCapture Whether to fire in capture phase
 *     (defaults to false).
 * @param {SCOPE=} opt_listenerScope Object in whose scope to call the
 *     listener.
 * @return {!goog.events.ListenableKey} Unique key for the listener.
 * @template SCOPE,EVENTOBJ
 */
goog.events.Listenable.prototype.listenOnce = function(
    type, listener, opt_useCapture, opt_listenerScope) {};


/**
 * Removes an event listener which was added with listen() or listenOnce().
 *
 * @param {string|!goog.events.EventId<EVENTOBJ>} type The event type id.
 * @param {function(this:SCOPE, EVENTOBJ):(boolean|undefined)} listener Callback
 *     method.
 * @param {boolean=} opt_useCapture Whether to fire in capture phase
 *     (defaults to false).
 * @param {SCOPE=} opt_listenerScope Object in whose scope to call
 *     the listener.
 * @return {boolean} Whether any listener was removed.
 * @template SCOPE,EVENTOBJ
 */
goog.events.Listenable.prototype.unlisten = function(
    type, listener, opt_useCapture, opt_listenerScope) {};


/**
 * Removes an event listener which was added with listen() by the key
 * returned by listen().
 *
 * @param {!goog.events.ListenableKey} key The key returned by
 *     listen() or listenOnce().
 * @return {boolean} Whether any listener was removed.
 */
goog.events.Listenable.prototype.unlistenByKey = function(key) {};


/**
 * Dispatches an event (or event like object) and calls all listeners
 * listening for events of this type. The type of the event is decided by the
 * type property on the event object.
 *
 * If any of the listeners returns false OR calls preventDefault then this
 * function will return false.  If one of the capture listeners calls
 * stopPropagation, then the bubble listeners won't fire.
 *
 * @param {?goog.events.EventLike} e Event object.
 * @return {boolean} If anyone called preventDefault on the event object (or
 *     if any of the listeners returns false) this will also return false.
 */
goog.events.Listenable.prototype.dispatchEvent = function(e) {};


/**
 * Removes all listeners from this listenable. If type is specified,
 * it will only remove listeners of the particular type. otherwise all
 * registered listeners will be removed.
 *
 * @param {string|!goog.events.EventId=} opt_type Type of event to remove,
 *     default is to remove all types.
 * @return {number} Number of listeners removed.
 */
goog.events.Listenable.prototype.removeAllListeners = function(opt_type) {};


/**
 * Returns the parent of this event target to use for capture/bubble
 * mechanism.
 *
 * NOTE(chrishenry): The name reflects the original implementation of
 * custom event target (`goog.events.EventTarget`). We decided
 * that changing the name is not worth it.
 *
 * @return {?goog.events.Listenable} The parent EventTarget or null if
 *     there is no parent.
 */
goog.events.Listenable.prototype.getParentEventTarget = function() {};


/**
 * Fires all registered listeners in this listenable for the given
 * type and capture mode, passing them the given eventObject. This
 * does not perform actual capture/bubble. Only implementors of the
 * interface should be using this.
 *
 * @param {string|!goog.events.EventId<EVENTOBJ>} type The type of the
 *     listeners to fire.
 * @param {boolean} capture The capture mode of the listeners to fire.
 * @param {EVENTOBJ} eventObject The event object to fire.
 * @return {boolean} Whether all listeners succeeded without
 *     attempting to prevent default behavior. If any listener returns
 *     false or called goog.events.Event#preventDefault, this returns
 *     false.
 * @template EVENTOBJ
 */
goog.events.Listenable.prototype.fireListeners = function(
    type, capture, eventObject) {};


/**
 * Gets all listeners in this listenable for the given type and
 * capture mode.
 *
 * @param {string|!goog.events.EventId} type The type of the listeners to fire.
 * @param {boolean} capture The capture mode of the listeners to fire.
 * @return {!Array<!goog.events.ListenableKey>} An array of registered
 *     listeners.
 * @template EVENTOBJ
 */
goog.events.Listenable.prototype.getListeners = function(type, capture) {};


/**
 * Gets the goog.events.ListenableKey for the event or null if no such
 * listener is in use.
 *
 * @param {string|!goog.events.EventId<EVENTOBJ>} type The name of the event
 *     without the 'on' prefix.
 * @param {function(this:SCOPE, EVENTOBJ):(boolean|undefined)} listener The
 *     listener function to get.
 * @param {boolean} capture Whether the listener is a capturing listener.
 * @param {SCOPE=} opt_listenerScope Object in whose scope to call the
 *     listener.
 * @return {?goog.events.ListenableKey} the found listener or null if not found.
 * @template SCOPE,EVENTOBJ
 */
goog.events.Listenable.prototype.getListener = function(
    type, listener, capture, opt_listenerScope) {};


/**
 * Whether there is any active listeners matching the specified
 * signature. If either the type or capture parameters are
 * unspecified, the function will match on the remaining criteria.
 *
 * @param {string|!goog.events.EventId<EVENTOBJ>=} opt_type Event type.
 * @param {boolean=} opt_capture Whether to check for capture or bubble
 *     listeners.
 * @return {boolean} Whether there is any active listeners matching
 *     the requested type and/or capture phase.
 * @template EVENTOBJ
 */
goog.events.Listenable.prototype.hasListener = function(
    opt_type, opt_capture) {};


// goog/events/listenablekey.js

/**
 * @fileoverview An interface that describes a single registered listener.
 */
goog.provide('goog.events.ListenableKey');



/**
 * An interface that describes a single registered listener.
 * @interface
 */
goog.events.ListenableKey = function() {};


/**
 * Counter used to create a unique key
 * @type {number}
 * @private
 */
goog.events.ListenableKey.counter_ = 0;


/**
 * Reserves a key to be used for ListenableKey#key field.
 * @return {number} A number to be used to fill ListenableKey#key
 *     field.
 */
goog.events.ListenableKey.reserveKey = function() {
  'use strict';
  return ++goog.events.ListenableKey.counter_;
};


/**
 * The source event target.
 * @type {?Object|?goog.events.Listenable}
 */
goog.events.ListenableKey.prototype.src;


/**
 * The event type the listener is listening to.
 * @type {string}
 */
goog.events.ListenableKey.prototype.type;


/**
 * The listener function.
 * @type {function(?):?|{handleEvent:function(?):?}|null}
 */
goog.events.ListenableKey.prototype.listener;


/**
 * Whether the listener works on capture phase.
 * @type {boolean}
 */
goog.events.ListenableKey.prototype.capture;


/**
 * The 'this' object for the listener function's scope.
 * @type {?Object|undefined}
 */
goog.events.ListenableKey.prototype.handler;


/**
 * A globally unique number to identify the key.
 * @type {number}
 */
goog.events.ListenableKey.prototype.key;


// goog/events/listener.js

/**
 * @fileoverview Listener object.
 * @see ../demos/events.html
 */

goog.provide('goog.events.Listener');




/**
 * Simple class that stores information about a listener
 * @param {function(?):?} listener Callback function.
 * @param {Function} proxy Wrapper for the listener that patches the event.
 * @param {EventTarget|goog.events.Listenable} src Source object for
 *     the event.
 * @param {string} type Event type.
 * @param {boolean} capture Whether in capture or bubble phase.
 * @param {Object=} opt_handler Object in whose context to execute the callback.
 * @implements {goog.events.ListenableKey}
 * @constructor
 */
goog.events.Listener = function(
    listener, proxy, src, type, capture, opt_handler) {
  'use strict';
  if (goog.events.Listener.ENABLE_MONITORING) {
    this.creationStack = new Error().stack;
  }

  /** @override */
  this.listener = listener;

  /**
   * A wrapper over the original listener. This is used solely to
   * handle native browser events (it is used to simulate the capture
   * phase and to patch the event object).
   * @type {Function}
   */
  this.proxy = proxy;

  /**
   * Object or node that callback is listening to
   * @type {EventTarget|goog.events.Listenable}
   */
  this.src = src;

  /**
   * The event type.
   * @const {string}
   */
  this.type = type;

  /**
   * Whether the listener is being called in the capture or bubble phase
   * @const {boolean}
   */
  this.capture = !!capture;

  /**
   * Optional object whose context to execute the listener in
   * @type {Object|undefined}
   */
  this.handler = opt_handler;

  /**
   * The key of the listener.
   * @const {number}
   * @override
   */
  this.key = goog.events.ListenableKey.reserveKey();

  /**
   * Whether to remove the listener after it has been called.
   * @type {boolean}
   */
  this.callOnce = false;

  /**
   * Whether the listener has been removed.
   * @type {boolean}
   */
  this.removed = false;
};


/**
 * @define {boolean} Whether to enable the monitoring of the
 *     goog.events.Listener instances. Switching on the monitoring is only
 *     recommended for debugging because it has a significant impact on
 *     performance and memory usage. If switched off, the monitoring code
 *     compiles down to 0 bytes.
 */
goog.events.Listener.ENABLE_MONITORING =
    goog.define('goog.events.Listener.ENABLE_MONITORING', false);


/**
 * If monitoring the goog.events.Listener instances is enabled, stores the
 * creation stack trace of the Disposable instance.
 * @type {string}
 */
goog.events.Listener.prototype.creationStack;


/**
 * Marks this listener as removed. This also remove references held by
 * this listener object (such as listener and event source).
 */
goog.events.Listener.prototype.markAsRemoved = function() {
  'use strict';
  this.removed = true;
  this.listener = null;
  this.proxy = null;
  this.src = null;
  this.handler = null;
};


// goog/events/listenermap.js

/**
 * @fileoverview A map of listeners that provides utility functions to
 * deal with listeners on an event target. Used by
 * `goog.events.EventTarget`.
 *
 * WARNING: Do not use this class from outside goog.events package.
 *
 */

goog.provide('goog.events.ListenerMap');




/**
 * Creates a new listener map.
 * @param {EventTarget|goog.events.Listenable} src The src object.
 * @constructor
 * @final
 */
goog.events.ListenerMap = function(src) {
  'use strict';
  /** @type {EventTarget|goog.events.Listenable} */
  this.src = src;

  /**
   * Maps of event type to an array of listeners.
   * @type {!Object<string, !Array<!goog.events.Listener>>}
   */
  this.listeners = {};

  /**
   * The count of types in this map that have registered listeners.
   * @private {number}
   */
  this.typeCount_ = 0;
};


/**
 * @return {number} The count of event types in this map that actually
 *     have registered listeners.
 */
goog.events.ListenerMap.prototype.getTypeCount = function() {
  'use strict';
  return this.typeCount_;
};


/**
 * @return {number} Total number of registered listeners.
 */
goog.events.ListenerMap.prototype.getListenerCount = function() {
  'use strict';
  var count = 0;
  for (var type in this.listeners) {
    count += this.listeners[type].length;
  }
  return count;
};


/**
 * Adds an event listener. A listener can only be added once to an
 * object and if it is added again the key for the listener is
 * returned.
 *
 * Note that a one-off listener will not change an existing listener,
 * if any. On the other hand a normal listener will change existing
 * one-off listener to become a normal listener.
 *
 * @param {string|!goog.events.EventId} type The listener event type.
 * @param {!Function} listener This listener callback method.
 * @param {boolean} callOnce Whether the listener is a one-off
 *     listener.
 * @param {boolean=} opt_useCapture The capture mode of the listener.
 * @param {Object=} opt_listenerScope Object in whose scope to call the
 *     listener.
 * @return {!goog.events.ListenableKey} Unique key for the listener.
 */
goog.events.ListenerMap.prototype.add = function(
    type, listener, callOnce, opt_useCapture, opt_listenerScope) {
  'use strict';
  var typeStr = type.toString();
  var listenerArray = this.listeners[typeStr];
  if (!listenerArray) {
    listenerArray = this.listeners[typeStr] = [];
    this.typeCount_++;
  }

  var listenerObj;
  var index = goog.events.ListenerMap.findListenerIndex_(
      listenerArray, listener, opt_useCapture, opt_listenerScope);
  if (index > -1) {
    listenerObj = listenerArray[index];
    if (!callOnce) {
      // Ensure that, if there is an existing callOnce listener, it is no
      // longer a callOnce listener.
      listenerObj.callOnce = false;
    }
  } else {
    listenerObj = new goog.events.Listener(
        listener, null, this.src, typeStr, !!opt_useCapture, opt_listenerScope);
    listenerObj.callOnce = callOnce;
    listenerArray.push(listenerObj);
  }
  return listenerObj;
};


/**
 * Removes a matching listener.
 * @param {string|!goog.events.EventId} type The listener event type.
 * @param {!Function} listener This listener callback method.
 * @param {boolean=} opt_useCapture The capture mode of the listener.
 * @param {Object=} opt_listenerScope Object in whose scope to call the
 *     listener.
 * @return {boolean} Whether any listener was removed.
 */
goog.events.ListenerMap.prototype.remove = function(
    type, listener, opt_useCapture, opt_listenerScope) {
  'use strict';
  var typeStr = type.toString();
  if (!(typeStr in this.listeners)) {
    return false;
  }

  var listenerArray = this.listeners[typeStr];
  var index = goog.events.ListenerMap.findListenerIndex_(
      listenerArray, listener, opt_useCapture, opt_listenerScope);
  if (index > -1) {
    var listenerObj = listenerArray[index];
    listenerObj.markAsRemoved();
    goog.array.removeAt(listenerArray, index);
    if (listenerArray.length == 0) {
      delete this.listeners[typeStr];
      this.typeCount_--;
    }
    return true;
  }
  return false;
};


/**
 * Removes the given listener object.
 * @param {!goog.events.ListenableKey} listener The listener to remove.
 * @return {boolean} Whether the listener is removed.
 */
goog.events.ListenerMap.prototype.removeByKey = function(listener) {
  'use strict';
  var type = listener.type;
  if (!(type in this.listeners)) {
    return false;
  }

  var removed = goog.array.remove(this.listeners[type], listener);
  if (removed) {
    /** @type {!goog.events.Listener} */ (listener).markAsRemoved();
    if (this.listeners[type].length == 0) {
      delete this.listeners[type];
      this.typeCount_--;
    }
  }
  return removed;
};


/**
 * Removes all listeners from this map. If opt_type is provided, only
 * listeners that match the given type are removed.
 * @param {string|!goog.events.EventId=} opt_type Type of event to remove.
 * @return {number} Number of listeners removed.
 */
goog.events.ListenerMap.prototype.removeAll = function(opt_type) {
  'use strict';
  var typeStr = opt_type && opt_type.toString();
  var count = 0;
  for (var type in this.listeners) {
    if (!typeStr || type == typeStr) {
      var listenerArray = this.listeners[type];
      for (var i = 0; i < listenerArray.length; i++) {
        ++count;
        listenerArray[i].markAsRemoved();
      }
      delete this.listeners[type];
      this.typeCount_--;
    }
  }
  return count;
};


/**
 * Gets all listeners that match the given type and capture mode. The
 * returned array is a copy (but the listener objects are not).
 * @param {string|!goog.events.EventId} type The type of the listeners
 *     to retrieve.
 * @param {boolean} capture The capture mode of the listeners to retrieve.
 * @return {!Array<!goog.events.ListenableKey>} An array of matching
 *     listeners.
 */
goog.events.ListenerMap.prototype.getListeners = function(type, capture) {
  'use strict';
  var listenerArray = this.listeners[type.toString()];
  var rv = [];
  if (listenerArray) {
    for (var i = 0; i < listenerArray.length; ++i) {
      var listenerObj = listenerArray[i];
      if (listenerObj.capture == capture) {
        rv.push(listenerObj);
      }
    }
  }
  return rv;
};


/**
 * Gets the goog.events.ListenableKey for the event or null if no such
 * listener is in use.
 *
 * @param {string|!goog.events.EventId} type The type of the listener
 *     to retrieve.
 * @param {!Function} listener The listener function to get.
 * @param {boolean} capture Whether the listener is a capturing listener.
 * @param {Object=} opt_listenerScope Object in whose scope to call the
 *     listener.
 * @return {goog.events.ListenableKey} the found listener or null if not found.
 */
goog.events.ListenerMap.prototype.getListener = function(
    type, listener, capture, opt_listenerScope) {
  'use strict';
  var listenerArray = this.listeners[type.toString()];
  var i = -1;
  if (listenerArray) {
    i = goog.events.ListenerMap.findListenerIndex_(
        listenerArray, listener, capture, opt_listenerScope);
  }
  return i > -1 ? listenerArray[i] : null;
};


/**
 * Whether there is a matching listener. If either the type or capture
 * parameters are unspecified, the function will match on the
 * remaining criteria.
 *
 * @param {string|!goog.events.EventId=} opt_type The type of the listener.
 * @param {boolean=} opt_capture The capture mode of the listener.
 * @return {boolean} Whether there is an active listener matching
 *     the requested type and/or capture phase.
 */
goog.events.ListenerMap.prototype.hasListener = function(
    opt_type, opt_capture) {
  'use strict';
  var hasType = (opt_type !== undefined);
  var typeStr = hasType ? opt_type.toString() : '';
  var hasCapture = (opt_capture !== undefined);

  return goog.object.some(this.listeners, function(listenerArray, type) {
    'use strict';
    for (var i = 0; i < listenerArray.length; ++i) {
      if ((!hasType || listenerArray[i].type == typeStr) &&
          (!hasCapture || listenerArray[i].capture == opt_capture)) {
        return true;
      }
    }

    return false;
  });
};


/**
 * Finds the index of a matching goog.events.Listener in the given
 * listenerArray.
 * @param {!Array<!goog.events.Listener>} listenerArray Array of listener.
 * @param {!Function} listener The listener function.
 * @param {boolean=} opt_useCapture The capture flag for the listener.
 * @param {Object=} opt_listenerScope The listener scope.
 * @return {number} The index of the matching listener within the
 *     listenerArray.
 * @private
 */
goog.events.ListenerMap.findListenerIndex_ = function(
    listenerArray, listener, opt_useCapture, opt_listenerScope) {
  'use strict';
  for (var i = 0; i < listenerArray.length; ++i) {
    var listenerObj = listenerArray[i];
    if (!listenerObj.removed && listenerObj.listener == listener &&
        listenerObj.capture == !!opt_useCapture &&
        listenerObj.handler == opt_listenerScope) {
      return i;
    }
  }
  return -1;
};


// goog/events/eventtarget.js

/**
 * @fileoverview A disposable implementation of a custom
 * listenable/event target. See also: documentation for
 * `goog.events.Listenable`.
 *
 * @see ../demos/eventtarget.html
 * @see goog.events.Listenable
 */

goog.provide('goog.events.EventTarget');




/**
 * An implementation of `goog.events.Listenable` with full W3C
 * EventTarget-like support (capture/bubble mechanism, stopping event
 * propagation, preventing default actions).
 *
 * You may subclass this class to turn your class into a Listenable.
 *
 * Unless propagation is stopped, an event dispatched by an
 * EventTarget will bubble to the parent returned by
 * `getParentEventTarget`. To set the parent, call
 * `setParentEventTarget`. Subclasses that don't support
 * changing the parent can override the setter to throw an error.
 *
 * Example usage:
 * <pre>
 *   var source = new goog.events.EventTarget();
 *   function handleEvent(e) {
 *     alert('Type: ' + e.type + '; Target: ' + e.target);
 *   }
 *   source.listen('foo', handleEvent);
 *   // Or: goog.events.listen(source, 'foo', handleEvent);
 *   ...
 *   source.dispatchEvent('foo');  // will call handleEvent
 *   ...
 *   source.unlisten('foo', handleEvent);
 *   // Or: goog.events.unlisten(source, 'foo', handleEvent);
 * </pre>
 *
 * @constructor
 * @extends {goog.Disposable}
 * @implements {goog.events.Listenable}
 */
goog.events.EventTarget = function() {
  'use strict';
  goog.Disposable.call(this);

  /**
   * Maps of event type to an array of listeners.
   * @private {!goog.events.ListenerMap}
   */
  this.eventTargetListeners_ = new goog.events.ListenerMap(this);

  /**
   * The object to use for event.target. Useful when mixing in an
   * EventTarget to another object.
   * @private {!Object}
   */
  this.actualEventTarget_ = this;

  /**
   * Parent event target, used during event bubbling.
   *
   * TODO(chrishenry): Change this to goog.events.Listenable. This
   * currently breaks people who expect getParentEventTarget to return
   * goog.events.EventTarget.
   *
   * @private {?goog.events.EventTarget}
   */
  this.parentEventTarget_ = null;
};
goog.inherits(goog.events.EventTarget, goog.Disposable);
goog.events.Listenable.addImplementation(goog.events.EventTarget);


/**
 * An artificial cap on the number of ancestors you can have. This is mainly
 * for loop detection.
 * @const {number}
 * @private
 */
goog.events.EventTarget.MAX_ANCESTORS_ = 1000;


/**
 * Returns the parent of this event target to use for bubbling.
 *
 * @return {goog.events.EventTarget} The parent EventTarget or null if
 *     there is no parent.
 * @override
 */
goog.events.EventTarget.prototype.getParentEventTarget = function() {
  'use strict';
  return this.parentEventTarget_;
};


/**
 * Sets the parent of this event target to use for capture/bubble
 * mechanism.
 * @param {goog.events.EventTarget} parent Parent listenable (null if none).
 */
goog.events.EventTarget.prototype.setParentEventTarget = function(parent) {
  'use strict';
  this.parentEventTarget_ = parent;
};


/**
 * Adds an event listener to the event target. The same handler can only be
 * added once per the type. Even if you add the same handler multiple times
 * using the same type then it will only be called once when the event is
 * dispatched.
 *
 * @param {string|!goog.events.EventId} type The type of the event to listen for
 * @param {function(?):?|{handleEvent:function(?):?}|null} handler The function
 *     to handle the event. The handler can also be an object that implements
 *     the handleEvent method which takes the event object as argument.
 * @param {boolean=} opt_capture In DOM-compliant browsers, this determines
 *     whether the listener is fired during the capture or bubble phase
 *     of the event.
 * @param {Object=} opt_handlerScope Object in whose scope to call
 *     the listener.
 * @deprecated Use `#listen` instead, when possible. Otherwise, use
 *     `goog.events.listen` if you are passing Object
 *     (instead of Function) as handler.
 */
goog.events.EventTarget.prototype.addEventListener = function(
    type, handler, opt_capture, opt_handlerScope) {
  'use strict';
  goog.events.listen(this, type, handler, opt_capture, opt_handlerScope);
};


/**
 * Removes an event listener from the event target. The handler must be the
 * same object as the one added. If the handler has not been added then
 * nothing is done.
 *
 * @param {string|!goog.events.EventId} type The type of the event to listen for
 * @param {function(?):?|{handleEvent:function(?):?}|null} handler The function
 *     to handle the event. The handler can also be an object that implements
 *     the handleEvent method which takes the event object as argument.
 * @param {boolean=} opt_capture In DOM-compliant browsers, this determines
 *     whether the listener is fired during the capture or bubble phase
 *     of the event.
 * @param {Object=} opt_handlerScope Object in whose scope to call
 *     the listener.
 * @deprecated Use `#unlisten` instead, when possible. Otherwise, use
 *     `goog.events.unlisten` if you are passing Object
 *     (instead of Function) as handler.
 */
goog.events.EventTarget.prototype.removeEventListener = function(
    type, handler, opt_capture, opt_handlerScope) {
  'use strict';
  goog.events.unlisten(this, type, handler, opt_capture, opt_handlerScope);
};


/**
 * @param {?goog.events.EventLike} e Event object.
 * @return {boolean} If anyone called preventDefault on the event object (or
 *     if any of the listeners returns false) this will also return false.
 * @override
 */
goog.events.EventTarget.prototype.dispatchEvent = function(e) {
  'use strict';
  this.assertInitialized_();

  var ancestorsTree, ancestor = this.getParentEventTarget();
  if (ancestor) {
    ancestorsTree = [];
    var ancestorCount = 1;
    for (; ancestor; ancestor = ancestor.getParentEventTarget()) {
      ancestorsTree.push(ancestor);
      goog.asserts.assert(
          (++ancestorCount < goog.events.EventTarget.MAX_ANCESTORS_),
          'infinite loop');
    }
  }

  return goog.events.EventTarget.dispatchEventInternal_(
      this.actualEventTarget_, e, ancestorsTree);
};


/**
 * Removes listeners from this object.  Classes that extend EventTarget may
 * need to override this method in order to remove references to DOM Elements
 * and additional listeners.
 * @override
 * @protected
 */
goog.events.EventTarget.prototype.disposeInternal = function() {
  'use strict';
  goog.events.EventTarget.superClass_.disposeInternal.call(this);

  this.removeAllListeners();
  this.parentEventTarget_ = null;
};


/**
 * @param {string|!goog.events.EventId<EVENTOBJ>} type The event type id.
 * @param {function(this:SCOPE, EVENTOBJ):(boolean|undefined)} listener Callback
 *     method.
 * @param {boolean=} opt_useCapture Whether to fire in capture phase
 *     (defaults to false).
 * @param {SCOPE=} opt_listenerScope Object in whose scope to call the
 *     listener.
 * @return {!goog.events.ListenableKey} Unique key for the listener.
 * @template SCOPE,EVENTOBJ
 * @override
 */
goog.events.EventTarget.prototype.listen = function(
    type, listener, opt_useCapture, opt_listenerScope) {
  'use strict';
  this.assertInitialized_();
  return this.eventTargetListeners_.add(
      String(type), listener, false /* callOnce */, opt_useCapture,
      opt_listenerScope);
};


/**
 * @param {string|!goog.events.EventId<EVENTOBJ>} type The event type id.
 * @param {function(this:SCOPE, EVENTOBJ):(boolean|undefined)} listener Callback
 *     method.
 * @param {boolean=} opt_useCapture Whether to fire in capture phase
 *     (defaults to false).
 * @param {SCOPE=} opt_listenerScope Object in whose scope to call the
 *     listener.
 * @return {!goog.events.ListenableKey} Unique key for the listener.
 * @template SCOPE,EVENTOBJ
 * @override
 */
goog.events.EventTarget.prototype.listenOnce = function(
    type, listener, opt_useCapture, opt_listenerScope) {
  'use strict';
  return this.eventTargetListeners_.add(
      String(type), listener, true /* callOnce */, opt_useCapture,
      opt_listenerScope);
};


/**
 * @param {string|!goog.events.EventId<EVENTOBJ>} type The event type id.
 * @param {function(this:SCOPE, EVENTOBJ):(boolean|undefined)} listener Callback
 *     method.
 * @param {boolean=} opt_useCapture Whether to fire in capture phase
 *     (defaults to false).
 * @param {SCOPE=} opt_listenerScope Object in whose scope to call
 *     the listener.
 * @return {boolean} Whether any listener was removed.
 * @template SCOPE,EVENTOBJ
 * @override
 */
goog.events.EventTarget.prototype.unlisten = function(
    type, listener, opt_useCapture, opt_listenerScope) {
  'use strict';
  return this.eventTargetListeners_.remove(
      String(type), listener, opt_useCapture, opt_listenerScope);
};


/**
 * @param {!goog.events.ListenableKey} key The key returned by
 *     listen() or listenOnce().
 * @return {boolean} Whether any listener was removed.
 * @override
 */
goog.events.EventTarget.prototype.unlistenByKey = function(key) {
  'use strict';
  return this.eventTargetListeners_.removeByKey(key);
};


/**
 * @param {string|!goog.events.EventId=} opt_type Type of event to remove,
 *     default is to remove all types.
 * @return {number} Number of listeners removed.
 * @override
 */
goog.events.EventTarget.prototype.removeAllListeners = function(opt_type) {
  'use strict';
  // TODO(chrishenry): Previously, removeAllListeners can be called on
  // uninitialized EventTarget, so we preserve that behavior. We
  // should remove this when usages that rely on that fact are purged.
  if (!this.eventTargetListeners_) {
    return 0;
  }
  return this.eventTargetListeners_.removeAll(opt_type);
};


/**
 * @param {string|!goog.events.EventId<EVENTOBJ>} type The type of the
 *     listeners to fire.
 * @param {boolean} capture The capture mode of the listeners to fire.
 * @param {EVENTOBJ} eventObject The event object to fire.
 * @return {boolean} Whether all listeners succeeded without
 *     attempting to prevent default behavior. If any listener returns
 *     false or called goog.events.Event#preventDefault, this returns
 *     false.
 * @template EVENTOBJ
 * @override
 */
goog.events.EventTarget.prototype.fireListeners = function(
    type, capture, eventObject) {
  'use strict';
  // TODO(chrishenry): Original code avoids array creation when there
  // is no listener, so we do the same. If this optimization turns
  // out to be not required, we can replace this with
  // getListeners(type, capture) instead, which is simpler.
  var listenerArray = this.eventTargetListeners_.listeners[String(type)];
  if (!listenerArray) {
    return true;
  }
  listenerArray = listenerArray.concat();

  var rv = true;
  for (var i = 0; i < listenerArray.length; ++i) {
    var listener = listenerArray[i];
    // We might not have a listener if the listener was removed.
    if (listener && !listener.removed && listener.capture == capture) {
      var listenerFn = listener.listener;
      var listenerHandler = listener.handler || listener.src;

      if (listener.callOnce) {
        this.unlistenByKey(listener);
      }
      rv = listenerFn.call(listenerHandler, eventObject) !== false && rv;
    }
  }

  return rv && !eventObject.defaultPrevented;
};


/**
 * @param {string|!goog.events.EventId} type The type of the listeners to fire.
 * @param {boolean} capture The capture mode of the listeners to fire.
 * @return {!Array<!goog.events.ListenableKey>} An array of registered
 *     listeners.
 * @template EVENTOBJ
 * @override
 */
goog.events.EventTarget.prototype.getListeners = function(type, capture) {
  'use strict';
  return this.eventTargetListeners_.getListeners(String(type), capture);
};


/**
 * @param {string|!goog.events.EventId<EVENTOBJ>} type The name of the event
 *     without the 'on' prefix.
 * @param {function(this:SCOPE, EVENTOBJ):(boolean|undefined)} listener The
 *     listener function to get.
 * @param {boolean} capture Whether the listener is a capturing listener.
 * @param {SCOPE=} opt_listenerScope Object in whose scope to call the
 *     listener.
 * @return {?goog.events.ListenableKey} the found listener or null if not found.
 * @template SCOPE,EVENTOBJ
 * @override
 */
goog.events.EventTarget.prototype.getListener = function(
    type, listener, capture, opt_listenerScope) {
  'use strict';
  return this.eventTargetListeners_.getListener(
      String(type), listener, capture, opt_listenerScope);
};


/**
 * @param {string|!goog.events.EventId<EVENTOBJ>=} opt_type Event type.
 * @param {boolean=} opt_capture Whether to check for capture or bubble
 *     listeners.
 * @return {boolean} Whether there is any active listeners matching
 *     the requested type and/or capture phase.
 * @template EVENTOBJ
 * @override
 */
goog.events.EventTarget.prototype.hasListener = function(
    opt_type, opt_capture) {
  'use strict';
  var id = (opt_type !== undefined) ? String(opt_type) : undefined;
  return this.eventTargetListeners_.hasListener(id, opt_capture);
};


/**
 * Sets the target to be used for `event.target` when firing
 * event. Mainly used for testing. For example, see
 * `goog.testing.events.mixinListenable`.
 * @param {!Object} target The target.
 */
goog.events.EventTarget.prototype.setTargetForTesting = function(target) {
  'use strict';
  this.actualEventTarget_ = target;
};


/**
 * Asserts that the event target instance is initialized properly.
 * @private
 */
goog.events.EventTarget.prototype.assertInitialized_ = function() {
  'use strict';
  goog.asserts.assert(
      this.eventTargetListeners_,
      'Event target is not initialized. Did you call the superclass ' +
          '(goog.events.EventTarget) constructor?');
};


/**
 * Dispatches the given event on the ancestorsTree.
 *
 * @param {!Object} target The target to dispatch on.
 * @param {goog.events.Event|Object|string} e The event object.
 * @param {Array<goog.events.Listenable>=} opt_ancestorsTree The ancestors
 *     tree of the target, in reverse order from the closest ancestor
 *     to the root event target. May be null if the target has no ancestor.
 * @return {boolean} If anyone called preventDefault on the event object (or
 *     if any of the listeners returns false) this will also return false.
 * @private
 */
goog.events.EventTarget.dispatchEventInternal_ = function(
    target, e, opt_ancestorsTree) {
  'use strict';
  /** @suppress {missingProperties} */
  var type = e.type || /** @type {string} */ (e);

  // If accepting a string or object, create a custom event object so that
  // preventDefault and stopPropagation work with the event.
  if (typeof e === 'string') {
    e = new goog.events.Event(e, target);
  } else if (!(e instanceof goog.events.Event)) {
    var oldEvent = e;
    e = new goog.events.Event(type, target);
    goog.object.extend(e, oldEvent);
  } else {
    e.target = e.target || target;
  }

  var rv = true, currentTarget;

  // Executes all capture listeners on the ancestors, if any.
  if (opt_ancestorsTree) {
    for (var i = opt_ancestorsTree.length - 1;
         !e.hasPropagationStopped() && i >= 0; i--) {
      currentTarget = e.currentTarget = opt_ancestorsTree[i];
      rv = currentTarget.fireListeners(type, true, e) && rv;
    }
  }

  // Executes capture and bubble listeners on the target.
  if (!e.hasPropagationStopped()) {
    currentTarget = /** @type {?} */ (e.currentTarget = target);
    rv = currentTarget.fireListeners(type, true, e) && rv;
    if (!e.hasPropagationStopped()) {
      rv = currentTarget.fireListeners(type, false, e) && rv;
    }
  }

  // Executes all bubble listeners on the ancestors, if any.
  if (opt_ancestorsTree) {
    for (i = 0; !e.hasPropagationStopped() && i < opt_ancestorsTree.length;
         i++) {
      currentTarget = e.currentTarget = opt_ancestorsTree[i];
      rv = currentTarget.fireListeners(type, false, e) && rv;
    }
  }

  return rv;
};


// goog/net/errorcode.js

/**
 * @fileoverview Error codes shared between goog.net.IframeIo and
 * goog.net.XhrIo.
 */

goog.provide('goog.net.ErrorCode');


/**
 * Error codes
 * @enum {number}
 */
goog.net.ErrorCode = {

  /**
   * There is no error condition.
   */
  NO_ERROR: 0,

  /**
   * The most common error from iframeio, unfortunately, is that the browser
   * responded with an error page that is classed as a different domain. The
   * situations, are when a browser error page  is shown -- 404, access denied,
   * DNS failure, connection reset etc.)
   *
   */
  ACCESS_DENIED: 1,

  /**
   * Currently the only case where file not found will be caused is when the
   * code is running on the local file system and a non-IE browser makes a
   * request to a file that doesn't exist.
   */
  FILE_NOT_FOUND: 2,

  /**
   * If Firefox shows a browser error page, such as a connection reset by
   * server or access denied, then it will fail silently without the error or
   * load handlers firing.
   */
  FF_SILENT_ERROR: 3,

  /**
   * Custom error provided by the client through the error check hook.
   */
  CUSTOM_ERROR: 4,

  /**
   * Exception was thrown while processing the request.
   */
  EXCEPTION: 5,

  /**
   * The Http response returned a non-successful http status code.
   */
  HTTP_ERROR: 6,

  /**
   * The request was aborted.
   */
  ABORT: 7,

  /**
   * The request timed out.
   */
  TIMEOUT: 8,

  /**
   * The resource is not available offline.
   */
  OFFLINE: 9,
};


/**
 * Returns a friendly error message for an error code. These messages are for
 * debugging and are not localized.
 * @param {goog.net.ErrorCode} errorCode An error code.
 * @return {string} A message for debugging.
 */
goog.net.ErrorCode.getDebugMessage = function(errorCode) {
  'use strict';
  switch (errorCode) {
    case goog.net.ErrorCode.NO_ERROR:
      return 'No Error';

    case goog.net.ErrorCode.ACCESS_DENIED:
      return 'Access denied to content document';

    case goog.net.ErrorCode.FILE_NOT_FOUND:
      return 'File not found';

    case goog.net.ErrorCode.FF_SILENT_ERROR:
      return 'Firefox silently errored';

    case goog.net.ErrorCode.CUSTOM_ERROR:
      return 'Application custom error';

    case goog.net.ErrorCode.EXCEPTION:
      return 'An exception occurred';

    case goog.net.ErrorCode.HTTP_ERROR:
      return 'Http response at 400 or 500 level';

    case goog.net.ErrorCode.ABORT:
      return 'Request was aborted';

    case goog.net.ErrorCode.TIMEOUT:
      return 'Request timed out';

    case goog.net.ErrorCode.OFFLINE:
      return 'The resource is not available offline';

    default:
      return 'Unrecognized error code';
  }
};


// goog/net/eventtype.js

/**
 * @fileoverview Common events for the network classes.
 */


goog.provide('goog.net.EventType');


/**
 * Event names for network events
 * @enum {string}
 */
goog.net.EventType = {
  COMPLETE: 'complete',
  SUCCESS: 'success',
  ERROR: 'error',
  ABORT: 'abort',
  READY: 'ready',
  READY_STATE_CHANGE: 'readystatechange',
  TIMEOUT: 'timeout',
  INCREMENTAL_DATA: 'incrementaldata',
  PROGRESS: 'progress',
  // DOWNLOAD_PROGRESS and UPLOAD_PROGRESS are special events dispatched by
  // goog.net.XhrIo to allow binding listeners specific to each type of
  // progress.
  DOWNLOAD_PROGRESS: 'downloadprogress',
  UPLOAD_PROGRESS: 'uploadprogress',
};


// goog/net/httpstatus.js

/**
 * @fileoverview Constants for HTTP status codes.
 */

goog.provide('goog.net.HttpStatus');


/**
 * HTTP Status Codes defined in RFC 2616, RFC 6585, RFC 4918 and RFC 7538.
 * @see http://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html
 * @see http://tools.ietf.org/html/rfc6585
 * @see https://tools.ietf.org/html/rfc4918
 * @see https://tools.ietf.org/html/rfc7538
 * @enum {number}
 */
goog.net.HttpStatus = {
  // Informational 1xx
  CONTINUE: 100,
  SWITCHING_PROTOCOLS: 101,

  // Successful 2xx
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NON_AUTHORITATIVE_INFORMATION: 203,
  NO_CONTENT: 204,
  RESET_CONTENT: 205,
  PARTIAL_CONTENT: 206,
  MULTI_STATUS: 207,

  // Redirection 3xx
  MULTIPLE_CHOICES: 300,
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  SEE_OTHER: 303,
  NOT_MODIFIED: 304,
  USE_PROXY: 305,
  TEMPORARY_REDIRECT: 307,
  PERMANENT_REDIRECT: 308,

  // Client Error 4xx
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  PROXY_AUTHENTICATION_REQUIRED: 407,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  LENGTH_REQUIRED: 411,
  PRECONDITION_FAILED: 412,
  REQUEST_ENTITY_TOO_LARGE: 413,
  REQUEST_URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  REQUEST_RANGE_NOT_SATISFIABLE: 416,
  EXPECTATION_FAILED: 417,
  UNPROCESSABLE_ENTITY: 422,
  LOCKED: 423,
  FAILED_DEPENDENCY: 424,
  PRECONDITION_REQUIRED: 428,
  TOO_MANY_REQUESTS: 429,
  REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  CLIENT_CLOSED_REQUEST: 499,  // Nonstandard, used by GRPC

  // Server Error 5xx
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  HTTP_VERSION_NOT_SUPPORTED: 505,
  INSUFFICIENT_STORAGE: 507,
  NETWORK_AUTHENTICATION_REQUIRED: 511,

  /*
   * IE returns this code for 204 due to its use of URLMon, which returns this
   * code for 'Operation Aborted'. The status text is 'Unknown', the response
   * headers are ''. Known to occur on IE 6 on XP through IE9 on Win7.
   */
  QUIRK_IE_NO_CONTENT: 1223,
};


/**
 * Returns whether the given status should be considered successful.
 *
 * Successful codes are OK (200), CREATED (201), ACCEPTED (202),
 * NO CONTENT (204), PARTIAL CONTENT (206), NOT MODIFIED (304),
 * and IE's no content code (1223).
 *
 * @param {number} status The status code to test.
 * @return {boolean} Whether the status code should be considered successful.
 */
goog.net.HttpStatus.isSuccess = function(status) {
  'use strict';
  switch (status) {
    case goog.net.HttpStatus.OK:
    case goog.net.HttpStatus.CREATED:
    case goog.net.HttpStatus.ACCEPTED:
    case goog.net.HttpStatus.NO_CONTENT:
    case goog.net.HttpStatus.PARTIAL_CONTENT:
    case goog.net.HttpStatus.NOT_MODIFIED:
    case goog.net.HttpStatus.QUIRK_IE_NO_CONTENT:
      return true;

    default:
      return false;
  }
};


// goog/net/xhrlike.js

goog.provide('goog.net.XhrLike');



/**
 * Interface for the common parts of XMLHttpRequest.
 *
 * Mostly copied from externs/w3c_xml.js.
 *
 * @interface
 * @see http://www.w3.org/TR/XMLHttpRequest/
 */
goog.net.XhrLike = function() {};


/**
 * Typedef that refers to either native or custom-implemented XHR objects.
 * @typedef {!goog.net.XhrLike|!XMLHttpRequest}
 */
goog.net.XhrLike.OrNative;


/**
 * @type {function()|null|undefined}
 * @see http://www.w3.org/TR/XMLHttpRequest/#handler-xhr-onreadystatechange
 */
goog.net.XhrLike.prototype.onreadystatechange;


/**
 * @type {?ArrayBuffer|?Blob|?Document|?Object|?string}
 * @see https://xhr.spec.whatwg.org/#response-object
 */
goog.net.XhrLike.prototype.response;


/**
 * @type {string}
 * @see http://www.w3.org/TR/XMLHttpRequest/#the-responsetext-attribute
 */
goog.net.XhrLike.prototype.responseText;


/**
 * @type {string}
 * @see https://xhr.spec.whatwg.org/#the-responsetype-attribute
 */
goog.net.XhrLike.prototype.responseType;


/**
 * @type {Document}
 * @see http://www.w3.org/TR/XMLHttpRequest/#the-responsexml-attribute
 */
goog.net.XhrLike.prototype.responseXML;


/**
 * @type {number}
 * @see http://www.w3.org/TR/XMLHttpRequest/#readystate
 */
goog.net.XhrLike.prototype.readyState;


/**
 * @type {number}
 * @see http://www.w3.org/TR/XMLHttpRequest/#status
 */
goog.net.XhrLike.prototype.status;


/**
 * @type {string}
 * @see http://www.w3.org/TR/XMLHttpRequest/#statustext
 */
goog.net.XhrLike.prototype.statusText;


/**
 * @param {string} method
 * @param {string} url
 * @param {?boolean=} opt_async
 * @param {?string=} opt_user
 * @param {?string=} opt_password
 * @see http://www.w3.org/TR/XMLHttpRequest/#the-open()-method
 */
goog.net.XhrLike.prototype.open = function(
    method, url, opt_async, opt_user, opt_password) {};


/**
 * @param {ArrayBuffer|ArrayBufferView|Blob|Document|FormData|string=} opt_data
 * @see http://www.w3.org/TR/XMLHttpRequest/#the-send()-method
 */
goog.net.XhrLike.prototype.send = function(opt_data) {};


/**
 * @see http://www.w3.org/TR/XMLHttpRequest/#the-abort()-method
 */
goog.net.XhrLike.prototype.abort = function() {};


/**
 * @param {string} header
 * @param {string} value
 * @see http://www.w3.org/TR/XMLHttpRequest/#the-setrequestheader()-method
 */
goog.net.XhrLike.prototype.setRequestHeader = function(header, value) {};


/**
 * @param {string} header
 * @return {?string}
 * @see http://www.w3.org/TR/XMLHttpRequest/#the-getresponseheader()-method
 */
goog.net.XhrLike.prototype.getResponseHeader = function(header) {};


/**
 * @return {string}
 * @see http://www.w3.org/TR/XMLHttpRequest/#the-getallresponseheaders()-method
 */
goog.net.XhrLike.prototype.getAllResponseHeaders = function() {};

/**
 * @type {?function(!TrustTokenAttributeType): void | undefined}
 * @see https://docs.google.com/document/d/1qUjtKgA7nMv9YGMhi0xWKEojkSITKzGLdIcZgoz6ZkI.
 */
goog.net.XhrLike.prototype.setTrustToken = function(trustTokenAttribute) {};


// goog/net/xmlhttpfactory.js

/**
 * @fileoverview Interface for a factory for creating XMLHttpRequest objects
 * and metadata about them.
 */

goog.provide('goog.net.XmlHttpFactory');

/** @suppress {extraRequire} Typedef. */



/**
 * Abstract base class for an XmlHttpRequest factory.
 * @constructor
 */
goog.net.XmlHttpFactory = function() {};


/**
 * Cache of options - we only actually call internalGetOptions once.
 * @type {?Object}
 * @private
 */
goog.net.XmlHttpFactory.prototype.cachedOptions_ = null;


/**
 * @return {!goog.net.XhrLike.OrNative} A new XhrLike instance.
 */
goog.net.XmlHttpFactory.prototype.createInstance = goog.abstractMethod;


/**
 * @return {Object} Options describing how xhr objects obtained from this
 *     factory should be used.
 */
goog.net.XmlHttpFactory.prototype.getOptions = function() {
  'use strict';
  return this.cachedOptions_ ||
      (this.cachedOptions_ = this.internalGetOptions());
};


/**
 * Override this method in subclasses to preserve the caching offered by
 * getOptions().
 * @return {Object} Options describing how xhr objects obtained from this
 *     factory should be used.
 * @protected
 */
goog.net.XmlHttpFactory.prototype.internalGetOptions = goog.abstractMethod;


// goog/net/wrapperxmlhttpfactory.js

/**
 * @fileoverview Implementation of XmlHttpFactory which allows construction from
 * simple factory methods.
 */

goog.provide('goog.net.WrapperXmlHttpFactory');

/** @suppress {extraRequire} Typedef. */



/**
 * An xhr factory subclass which can be constructed using two factory methods.
 * This exists partly to allow the preservation of goog.net.XmlHttp.setFactory()
 * with an unchanged signature.
 * @param {function():!goog.net.XhrLike.OrNative} xhrFactory
 *     A function which returns a new XHR object.
 * @param {function():!Object} optionsFactory A function which returns the
 *     options associated with xhr objects from this factory.
 * @extends {goog.net.XmlHttpFactory}
 * @constructor
 * @final
 */
goog.net.WrapperXmlHttpFactory = function(xhrFactory, optionsFactory) {
  'use strict';
  goog.net.XmlHttpFactory.call(this);

  /**
   * XHR factory method.
   * @type {function() : !goog.net.XhrLike.OrNative}
   * @private
   */
  this.xhrFactory_ = xhrFactory;

  /**
   * Options factory method.
   * @type {function() : !Object}
   * @private
   */
  this.optionsFactory_ = optionsFactory;
};
goog.inherits(goog.net.WrapperXmlHttpFactory, goog.net.XmlHttpFactory);


/** @override */
goog.net.WrapperXmlHttpFactory.prototype.createInstance = function() {
  'use strict';
  return this.xhrFactory_();
};


/** @override */
goog.net.WrapperXmlHttpFactory.prototype.getOptions = function() {
  'use strict';
  return this.optionsFactory_();
};


// goog/net/xmlhttp.js

/**
 * @fileoverview Low level handling of XMLHttpRequest.
 */

goog.provide('goog.net.DefaultXmlHttpFactory');
goog.provide('goog.net.XmlHttp');
goog.provide('goog.net.XmlHttp.OptionType');
goog.provide('goog.net.XmlHttp.ReadyState');
goog.provide('goog.net.XmlHttpDefines');



/**
 * Static class for creating XMLHttpRequest objects.
 * @return {!goog.net.XhrLike.OrNative} A new XMLHttpRequest object.
 */
goog.net.XmlHttp = function() {
  'use strict';
  return goog.net.XmlHttp.factory_.createInstance();
};


/**
 * @define {boolean} Whether to assume XMLHttpRequest exists. Setting this to
 *     true bypasses the ActiveX probing code.
 * NOTE(ruilopes): Due to the way JSCompiler works, this define *will not* strip
 * out the ActiveX probing code from binaries.  To achieve this, use
 * `goog.net.XmlHttpDefines.ASSUME_NATIVE_XHR` instead.
 * TODO(ruilopes): Collapse both defines.
 */
goog.net.XmlHttp.ASSUME_NATIVE_XHR =
    goog.define('goog.net.XmlHttp.ASSUME_NATIVE_XHR', false);


/** @const */
goog.net.XmlHttpDefines = {};


/**
 * @define {boolean} Whether to assume XMLHttpRequest exists. Setting this to
 *     true eliminates the ActiveX probing code.
 */
goog.net.XmlHttpDefines.ASSUME_NATIVE_XHR =
    goog.define('goog.net.XmlHttpDefines.ASSUME_NATIVE_XHR', false);


/**
 * Gets the options to use with the XMLHttpRequest objects obtained using
 * the static methods.
 * @return {Object} The options.
 */
goog.net.XmlHttp.getOptions = function() {
  'use strict';
  return goog.net.XmlHttp.factory_.getOptions();
};


/**
 * Type of options that an XmlHttp object can have.
 * @enum {number}
 */
goog.net.XmlHttp.OptionType = {
  /**
   * Whether a no-op function should be used to clear the onreadystatechange
   * handler instead of null.
   */
  USE_NULL_FUNCTION: 0,

  /**
   * NOTE(user): In IE if send() errors on a *local* request the readystate
   * is still changed to COMPLETE.  We need to ignore it and allow the
   * try/catch around send() to pick up the error.
   */
  LOCAL_REQUEST_ERROR: 1,
};


/**
 * Status constants for XMLHTTP, matches:
 * https://msdn.microsoft.com/en-us/library/ms534361(v=vs.85).aspx
 * @enum {number}
 */
goog.net.XmlHttp.ReadyState = {
  /**
   * Constant for when xmlhttprequest.readyState is uninitialized
   */
  UNINITIALIZED: 0,

  /**
   * Constant for when xmlhttprequest.readyState is loading.
   */
  LOADING: 1,

  /**
   * Constant for when xmlhttprequest.readyState is loaded.
   */
  LOADED: 2,

  /**
   * Constant for when xmlhttprequest.readyState is in an interactive state.
   */
  INTERACTIVE: 3,

  /**
   * Constant for when xmlhttprequest.readyState is completed
   */
  COMPLETE: 4,
};


/**
 * The global factory instance for creating XMLHttpRequest objects.
 * @type {goog.net.XmlHttpFactory}
 * @private
 */
goog.net.XmlHttp.factory_;


/**
 * Sets the factories for creating XMLHttpRequest objects and their options.
 * @param {Function} factory The factory for XMLHttpRequest objects.
 * @param {Function} optionsFactory The factory for options.
 * @deprecated Use setGlobalFactory instead.
 */
goog.net.XmlHttp.setFactory = function(factory, optionsFactory) {
  'use strict';
  goog.net.XmlHttp.setGlobalFactory(new goog.net.WrapperXmlHttpFactory(
      goog.asserts.assert(factory), goog.asserts.assert(optionsFactory)));
};


/**
 * Sets the global factory object.
 * @param {!goog.net.XmlHttpFactory} factory New global factory object.
 */
goog.net.XmlHttp.setGlobalFactory = function(factory) {
  'use strict';
  goog.net.XmlHttp.factory_ = factory;
};



/**
 * Default factory to use when creating xhr objects.  You probably shouldn't be
 * instantiating this directly, but rather using it via goog.net.XmlHttp.
 * @extends {goog.net.XmlHttpFactory}
 * @constructor
 */
goog.net.DefaultXmlHttpFactory = function() {
  'use strict';
  goog.net.XmlHttpFactory.call(this);
};
goog.inherits(goog.net.DefaultXmlHttpFactory, goog.net.XmlHttpFactory);


/** @override */
goog.net.DefaultXmlHttpFactory.prototype.createInstance = function() {
  'use strict';
  const progId = this.getProgId_();
  if (progId) {
    return new ActiveXObject(progId);
  } else {
    return new XMLHttpRequest();
  }
};


/** @override */
goog.net.DefaultXmlHttpFactory.prototype.internalGetOptions = function() {
  'use strict';
  const progId = this.getProgId_();
  const options = {};
  if (progId) {
    options[goog.net.XmlHttp.OptionType.USE_NULL_FUNCTION] = true;
    options[goog.net.XmlHttp.OptionType.LOCAL_REQUEST_ERROR] = true;
  }
  return options;
};


/**
 * The ActiveX PROG ID string to use to create xhr's in IE. Lazily initialized.
 * @type {string|undefined}
 * @private
 */
goog.net.DefaultXmlHttpFactory.prototype.ieProgId_;


/**
 * Initialize the private state used by other functions.
 * @return {string} The ActiveX PROG ID string to use to create xhr's in IE.
 * @private
 */
goog.net.DefaultXmlHttpFactory.prototype.getProgId_ = function() {
  'use strict';
  if (goog.net.XmlHttp.ASSUME_NATIVE_XHR ||
      goog.net.XmlHttpDefines.ASSUME_NATIVE_XHR) {
    return '';
  }

  // The following blog post describes what PROG IDs to use to create the
  // XMLHTTP object in Internet Explorer:
  // http://blogs.msdn.com/xmlteam/archive/2006/10/23/using-the-right-version-of-msxml-in-internet-explorer.aspx
  // However we do not (yet) fully trust that this will be OK for old versions
  // of IE on Win9x so we therefore keep the last 2.
  if (!this.ieProgId_ && typeof XMLHttpRequest == 'undefined' &&
      typeof ActiveXObject != 'undefined') {
    // Candidate Active X types.
    const ACTIVE_X_IDENTS = [
      'MSXML2.XMLHTTP.6.0',
      'MSXML2.XMLHTTP.3.0',
      'MSXML2.XMLHTTP',
      'Microsoft.XMLHTTP',
    ];
    for (let i = 0; i < ACTIVE_X_IDENTS.length; i++) {
      const candidate = ACTIVE_X_IDENTS[i];

      try {
        new ActiveXObject(candidate);
        // NOTE(user): cannot assign progid and return candidate in one line
        // because JSCompiler complaings: BUG 658126
        this.ieProgId_ = candidate;
        return candidate;
      } catch (e) {
        // do nothing; try next choice
      }
    }

    // couldn't find any matches
    throw new Error(
        'Could not create ActiveXObject. ActiveX might be disabled,' +
        ' or MSXML might not be installed');
  }

  return /** @type {string} */ (this.ieProgId_);
};


// Set the global factory to an instance of the default factory.
goog.net.XmlHttp.setGlobalFactory(new goog.net.DefaultXmlHttpFactory());


// goog/net/xhrio.js

/**
 * @fileoverview Wrapper class for handling XmlHttpRequests.
 *
 * One off requests can be sent through goog.net.XhrIo.send() or an
 * instance can be created to send multiple requests.  Each request uses its
 * own XmlHttpRequest object and handles clearing of the event callback to
 * ensure no leaks.
 *
 * XhrIo is event based, it dispatches events on success, failure, finishing,
 * ready-state change, or progress (download and upload).
 *
 * The ready-state or timeout event fires first, followed by
 * a generic completed event. Then the abort, error, or success event
 * is fired as appropriate. Progress events are fired as they are
 * received. Lastly, the ready event will fire to indicate that the
 * object may be used to make another request.
 *
 * The error event may also be called before completed and
 * ready-state-change if the XmlHttpRequest.open() or .send() methods throw.
 *
 * This class does not support multiple requests, queuing, or prioritization.
 *
 * When progress events are supported by the browser, and progress is
 * enabled via .setProgressEventsEnabled(true), the
 * goog.net.EventType.PROGRESS event will be the re-dispatched browser
 * progress event. Additionally, a DOWNLOAD_PROGRESS or UPLOAD_PROGRESS event
 * will be fired for download and upload progress respectively.
 */


goog.provide('goog.net.XhrIo');
goog.provide('goog.net.XhrIo.ResponseType');


goog.scope(function() {

'use strict';
/**
 * Basic class for handling XMLHttpRequests.
 * @param {goog.net.XmlHttpFactory=} opt_xmlHttpFactory Factory to use when
 *     creating XMLHttpRequest objects.
 * @constructor
 * @extends {goog.events.EventTarget}
 */
goog.net.XhrIo = function(opt_xmlHttpFactory) {
  'use strict';
  XhrIo.base(this, 'constructor');

  /**
   * Map of default headers to add to every request, use:
   * XhrIo.headers.set(name, value)
   * @type {!Map<string,string>}
   */
  this.headers = new Map();

  /**
   * Optional XmlHttpFactory
   * @private {goog.net.XmlHttpFactory}
   */
  this.xmlHttpFactory_ = opt_xmlHttpFactory || null;

  /**
   * Whether XMLHttpRequest is active.  A request is active from the time send()
   * is called until onReadyStateChange() is complete, or error() or abort()
   * is called.
   * @private {boolean}
   */
  this.active_ = false;

  /**
   * The XMLHttpRequest object that is being used for the transfer.
   * @private {?goog.net.XhrLike.OrNative}
   */
  this.xhr_ = null;

  /**
   * The options to use with the current XMLHttpRequest object.
   * @private {?Object}
   */
  this.xhrOptions_ = null;

  /**
   * Last URL that was requested.
   * @private {string|goog.Uri}
   */
  this.lastUri_ = '';

  /**
   * Method for the last request.
   * @private {string}
   */
  this.lastMethod_ = '';

  /**
   * Last error code.
   * @private {!goog.net.ErrorCode}
   */
  this.lastErrorCode_ = goog.net.ErrorCode.NO_ERROR;

  /**
   * Last error message.
   * @private {Error|string}
   */
  this.lastError_ = '';

  /**
   * Used to ensure that we don't dispatch an multiple ERROR events. This can
   * happen in IE when it does a synchronous load and one error is handled in
   * the ready state change and one is handled due to send() throwing an
   * exception.
   * @private {boolean}
   */
  this.errorDispatched_ = false;

  /**
   * Used to make sure we don't fire the complete event from inside a send call.
   * @private {boolean}
   */
  this.inSend_ = false;

  /**
   * Used in determining if a call to {@link #onReadyStateChange_} is from
   * within a call to this.xhr_.open.
   * @private {boolean}
   */
  this.inOpen_ = false;

  /**
   * Used in determining if a call to {@link #onReadyStateChange_} is from
   * within a call to this.xhr_.abort.
   * @private {boolean}
   */
  this.inAbort_ = false;

  /**
   * Number of milliseconds after which an incomplete request will be aborted
   * and a {@link goog.net.EventType.TIMEOUT} event raised; 0 means no timeout
   * is set.
   * @private {number}
   */
  this.timeoutInterval_ = 0;

  /**
   * Timer to track request timeout.
   * @private {?number}
   */
  this.timeoutId_ = null;

  /**
   * The requested type for the response. The empty string means use the default
   * XHR behavior.
   * @private {goog.net.XhrIo.ResponseType}
   */
  this.responseType_ = ResponseType.DEFAULT;

  /**
   * Whether a "credentialed" request is to be sent (one that is aware of
   * cookies and authentication). This is applicable only for cross-domain
   * requests and more recent browsers that support this part of the HTTP Access
   * Control standard.
   *
   * @see http://www.w3.org/TR/XMLHttpRequest/#the-withcredentials-attribute
   *
   * @private {boolean}
   */
  this.withCredentials_ = false;

  /**
   * Whether progress events are enabled for this request. This is
   * disabled by default because setting a progress event handler
   * causes pre-flight OPTIONS requests to be sent for CORS requests,
   * even in cases where a pre-flight request would not otherwise be
   * sent.
   *
   * @see http://xhr.spec.whatwg.org/#security-considerations
   *
   * Note that this can cause problems for Firefox 22 and below, as an
   * older "LSProgressEvent" will be dispatched by the browser. That
   * progress event is no longer supported, and can lead to failures,
   * including throwing exceptions.
   *
   * @see http://bugzilla.mozilla.org/show_bug.cgi?id=845631
   * @see b/23469793
   *
   * @private {boolean}
   */
  this.progressEventsEnabled_ = false;

  /**
   * True if we can use XMLHttpRequest's timeout directly.
   * @private {boolean}
   */
  this.useXhr2Timeout_ = false;

  /**
   * Specification for Trust Token operations (issuance, signing, and
   * redemption).
   * @private {?TrustTokenAttributeType}
   */
  this.trustToken_ = null;
};
goog.inherits(goog.net.XhrIo, goog.events.EventTarget);

const XhrIo = goog.net.XhrIo;

/**
 * Response types that may be requested for XMLHttpRequests.
 * @enum {string}
 * @see http://www.w3.org/TR/XMLHttpRequest/#the-responsetype-attribute
 */
goog.net.XhrIo.ResponseType = {
  DEFAULT: '',
  TEXT: 'text',
  DOCUMENT: 'document',
  // Not supported as of Chrome 10.0.612.1 dev
  BLOB: 'blob',
  ARRAY_BUFFER: 'arraybuffer',
};

const ResponseType = goog.net.XhrIo.ResponseType;


/**
 * A reference to the XhrIo logger
 * @private {?goog.log.Logger}
 * @const
 */
goog.net.XhrIo.prototype.logger_ = goog.log.getLogger('goog.net.XhrIo');


/**
 * The Content-Type HTTP header name
 * @type {string}
 */
goog.net.XhrIo.CONTENT_TYPE_HEADER = 'Content-Type';


/**
 * The Content-Transfer-Encoding HTTP header name
 * @type {string}
 */
goog.net.XhrIo.CONTENT_TRANSFER_ENCODING = 'Content-Transfer-Encoding';


/**
 * The pattern matching the 'http' and 'https' URI schemes
 * @type {!RegExp}
 */
goog.net.XhrIo.HTTP_SCHEME_PATTERN = /^https?$/i;

const HTTP_SCHEME_PATTERN = goog.net.XhrIo.HTTP_SCHEME_PATTERN;


/**
 * The methods that typically come along with form data.  We set different
 * headers depending on whether the HTTP action is one of these.
 * @type {!Array<string>}
 */
goog.net.XhrIo.METHODS_WITH_FORM_DATA = ['POST', 'PUT'];


/**
 * The Content-Type HTTP header value for a url-encoded form
 * @type {string}
 */
goog.net.XhrIo.FORM_CONTENT_TYPE =
    'application/x-www-form-urlencoded;charset=utf-8';


/**
 * The XMLHttpRequest Level two timeout delay ms property name.
 *
 * @see http://www.w3.org/TR/XMLHttpRequest/#the-timeout-attribute
 *
 * @private {string}
 * @const
 */
goog.net.XhrIo.XHR2_TIMEOUT_ = 'timeout';


/**
 * The XMLHttpRequest Level two ontimeout handler property name.
 *
 * @see http://www.w3.org/TR/XMLHttpRequest/#the-timeout-attribute
 *
 * @private {string}
 * @const
 */
goog.net.XhrIo.XHR2_ON_TIMEOUT_ = 'ontimeout';


/**
 * All non-disposed instances of goog.net.XhrIo created
 * by {@link goog.net.XhrIo.send} are in this Array.
 * @see goog.net.XhrIo.cleanup
 * @private {!Array<!goog.net.XhrIo>}
 */
goog.net.XhrIo.sendInstances_ = [];


/**
 * Static send that creates a short lived instance of XhrIo to send the
 * request.
 * @see goog.net.XhrIo.cleanup
 * @param {string|goog.Uri} url Uri to make request to.
 * @param {?function(this:goog.net.XhrIo, ?)=} opt_callback Callback function
 *     for when request is complete.
 * @param {string=} opt_method Send method, default: GET.
 * @param {ArrayBuffer|ArrayBufferView|Blob|Document|FormData|string=}
 *     opt_content Body data.
 * @param {(?Object|?goog.collections.maps.MapLike<string, string>)=}
 *     opt_headers Map of headers to add to the request.
 * @param {number=} opt_timeoutInterval Number of milliseconds after which an
 *     incomplete request will be aborted; 0 means no timeout is set.
 * @param {boolean=} opt_withCredentials Whether to send credentials with the
 *     request. Default to false. See {@link goog.net.XhrIo#setWithCredentials}.
 * @return {!goog.net.XhrIo} The sent XhrIo.
 */
goog.net.XhrIo.send = function(
    url, opt_callback, opt_method, opt_content, opt_headers,
    opt_timeoutInterval, opt_withCredentials) {
  'use strict';
  const x = new goog.net.XhrIo();
  goog.net.XhrIo.sendInstances_.push(x);
  if (opt_callback) {
    x.listen(goog.net.EventType.COMPLETE, opt_callback);
  }
  x.listenOnce(goog.net.EventType.READY, x.cleanupSend_);
  if (opt_timeoutInterval) {
    x.setTimeoutInterval(opt_timeoutInterval);
  }
  if (opt_withCredentials) {
    x.setWithCredentials(opt_withCredentials);
  }
  x.send(url, opt_method, opt_content, opt_headers);
  return x;
};


/**
 * Disposes all non-disposed instances of goog.net.XhrIo created by
 * {@link goog.net.XhrIo.send}.
 * {@link goog.net.XhrIo.send} cleans up the goog.net.XhrIo instance
 * it creates when the request completes or fails.  However, if
 * the request never completes, then the goog.net.XhrIo is not disposed.
 * This can occur if the window is unloaded before the request completes.
 * We could have {@link goog.net.XhrIo.send} return the goog.net.XhrIo
 * it creates and make the client of {@link goog.net.XhrIo.send} be
 * responsible for disposing it in this case.  However, this makes things
 * significantly more complicated for the client, and the whole point
 * of {@link goog.net.XhrIo.send} is that it's simple and easy to use.
 * Clients of {@link goog.net.XhrIo.send} should call
 * {@link goog.net.XhrIo.cleanup} when doing final
 * cleanup on window unload.
 */
goog.net.XhrIo.cleanup = function() {
  'use strict';
  const instances = goog.net.XhrIo.sendInstances_;
  while (instances.length) {
    instances.pop().dispose();
  }
};


/**
 * Installs exception protection for all entry point introduced by
 * goog.net.XhrIo instances which are not protected by
 * {@link goog.debug.ErrorHandler#protectWindowSetTimeout},
 * {@link goog.debug.ErrorHandler#protectWindowSetInterval}, or
 * {@link goog.events.protectBrowserEventEntryPoint}.
 *
 * @param {goog.debug.ErrorHandler} errorHandler Error handler with which to
 *     protect the entry point(s).
 */
goog.net.XhrIo.protectEntryPoints = function(errorHandler) {
  'use strict';
  goog.net.XhrIo.prototype.onReadyStateChangeEntryPoint_ =
      errorHandler.protectEntryPoint(
          goog.net.XhrIo.prototype.onReadyStateChangeEntryPoint_);
};


/**
 * Disposes of the specified goog.net.XhrIo created by
 * {@link goog.net.XhrIo.send} and removes it from
 * {@link goog.net.XhrIo.pendingStaticSendInstances_}.
 * @private
 */
goog.net.XhrIo.prototype.cleanupSend_ = function() {
  'use strict';
  this.dispose();
  goog.array.remove(goog.net.XhrIo.sendInstances_, this);
};


/**
 * Returns the number of milliseconds after which an incomplete request will be
 * aborted, or 0 if no timeout is set.
 * @return {number} Timeout interval in milliseconds.
 */
goog.net.XhrIo.prototype.getTimeoutInterval = function() {
  'use strict';
  return this.timeoutInterval_;
};


/**
 * Sets the number of milliseconds after which an incomplete request will be
 * aborted and a {@link goog.net.EventType.TIMEOUT} event raised; 0 means no
 * timeout is set.
 * @param {number} ms Timeout interval in milliseconds; 0 means none.
 */
goog.net.XhrIo.prototype.setTimeoutInterval = function(ms) {
  'use strict';
  this.timeoutInterval_ = Math.max(0, ms);
};


/**
 * Sets the desired type for the response. At time of writing, this is only
 * supported in very recent versions of WebKit (10.0.612.1 dev and later).
 *
 * If this is used, the response may only be accessed via {@link #getResponse}.
 *
 * @param {goog.net.XhrIo.ResponseType} type The desired type for the response.
 */
goog.net.XhrIo.prototype.setResponseType = function(type) {
  'use strict';
  this.responseType_ = type;
};


/**
 * Gets the desired type for the response.
 * @return {goog.net.XhrIo.ResponseType} The desired type for the response.
 */
goog.net.XhrIo.prototype.getResponseType = function() {
  'use strict';
  return this.responseType_;
};


/**
 * Sets whether a "credentialed" request that is aware of cookie and
 * authentication information should be made. This option is only supported by
 * browsers that support HTTP Access Control. As of this writing, this option
 * is not supported in IE.
 *
 * @param {boolean} withCredentials Whether this should be a "credentialed"
 *     request.
 */
goog.net.XhrIo.prototype.setWithCredentials = function(withCredentials) {
  'use strict';
  this.withCredentials_ = withCredentials;
};


/**
 * Gets whether a "credentialed" request is to be sent.
 * @return {boolean} The desired type for the response.
 */
goog.net.XhrIo.prototype.getWithCredentials = function() {
  'use strict';
  return this.withCredentials_;
};


/**
 * Sets whether progress events are enabled for this request. Note
 * that progress events require pre-flight OPTIONS request handling
 * for CORS requests, and may cause trouble with older browsers. See
 * progressEventsEnabled_ for details.
 * @param {boolean} enabled Whether progress events should be enabled.
 */
goog.net.XhrIo.prototype.setProgressEventsEnabled = function(enabled) {
  'use strict';
  this.progressEventsEnabled_ = enabled;
};


/**
 * Gets whether progress events are enabled.
 * @return {boolean} Whether progress events are enabled for this request.
 */
goog.net.XhrIo.prototype.getProgressEventsEnabled = function() {
  'use strict';
  return this.progressEventsEnabled_;
};

/**
 * Specify a Trust Tokens operation to execute alongside the request.
 * @param {!TrustTokenAttributeType} trustToken a Trust Tokens operation to
 *     execute.
 */
goog.net.XhrIo.prototype.setTrustToken = function(trustToken) {
  'use strict';
  this.trustToken_ = trustToken;
};
/**
 * Instance send that actually uses XMLHttpRequest to make a server call.
 * @param {string|goog.Uri} url Uri to make request to.
 * @param {string=} opt_method Send method, default: GET.
 * @param {ArrayBuffer|ArrayBufferView|Blob|Document|FormData|string=}
 *     opt_content Body data.
 * @param {(?Object|?goog.collections.maps.MapLike<string, string>)=}
 *     opt_headers Map of headers to add to the request.
 * @suppress {strictMissingProperties} Added to tighten compiler checks
 * @suppress {deprecated} Use deprecated goog.structs.forEach to allow different
 * types of parameters for opt_headers.
 */
goog.net.XhrIo.prototype.send = function(
    url, opt_method, opt_content, opt_headers) {
  'use strict';
  if (this.xhr_) {
    throw new Error(
        '[goog.net.XhrIo] Object is active with another request=' +
        this.lastUri_ + '; newUri=' + url);
  }

  const method = opt_method ? opt_method.toUpperCase() : 'GET';

  this.lastUri_ = url;
  this.lastError_ = '';
  this.lastErrorCode_ = goog.net.ErrorCode.NO_ERROR;
  this.lastMethod_ = method;
  this.errorDispatched_ = false;
  this.active_ = true;

  // Use the factory to create the XHR object and options
  this.xhr_ = this.createXhr();
  this.xhrOptions_ = this.xmlHttpFactory_ ? this.xmlHttpFactory_.getOptions() :
                                            goog.net.XmlHttp.getOptions();

  // Set up the onreadystatechange callback
  this.xhr_.onreadystatechange = goog.bind(this.onReadyStateChange_, this);

  // Set up upload/download progress events, if progress events are supported.
  if (this.getProgressEventsEnabled() && 'onprogress' in this.xhr_) {
    /** @suppress {strictMissingProperties} Added to tighten compiler checks */
    this.xhr_.onprogress = goog.bind(function(e) {
      'use strict';
      this.onProgressHandler_(e, true);
    }, this);
    if (this.xhr_.upload) {
      /**
       * @suppress {strictMissingProperties} Added to tighten compiler checks
       */
      this.xhr_.upload.onprogress = goog.bind(this.onProgressHandler_, this);
    }
  }

  /**
   * Try to open the XMLHttpRequest (always async), if an error occurs here it
   * is generally permission denied
   */
  try {
    goog.log.fine(this.logger_, this.formatMsg_('Opening Xhr'));
    this.inOpen_ = true;
    this.xhr_.open(method, String(url), true);  // Always async!
    this.inOpen_ = false;
  } catch (err) {
    goog.log.fine(
        this.logger_, this.formatMsg_('Error opening Xhr: ' + err.message));
    this.error_(goog.net.ErrorCode.EXCEPTION, err);
    return;
  }

  // We can't use null since this won't allow requests with form data to have a
  // content length specified which will cause some proxies to return a 411
  // error.
  const content = opt_content || '';

  const headers = new Map(this.headers);

  // Add headers specific to this request
  if (opt_headers) {
    if (Object.getPrototypeOf(opt_headers) === Object.prototype) {
      for (let key in opt_headers) {
        headers.set(key, opt_headers[key]);
      }
    } else if (
        typeof opt_headers.keys === 'function' &&
        typeof opt_headers.get === 'function') {
      for (const key of opt_headers.keys()) {
        headers.set(key, opt_headers.get(key));
      }
    } else {
      throw new Error(
          'Unknown input type for opt_headers: ' + String(opt_headers));
    }
  }

  // Find whether a content type header is set, ignoring case.
  // HTTP header names are case-insensitive.  See:
  // http://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html#sec4.2
  const contentTypeKey =
      Array.from(headers.keys())
          .find(
              header => goog.string.caseInsensitiveEquals(
                  goog.net.XhrIo.CONTENT_TYPE_HEADER, header));

  const contentIsFormData =
      (goog.global['FormData'] && (content instanceof goog.global['FormData']));
  if (goog.array.contains(goog.net.XhrIo.METHODS_WITH_FORM_DATA, method) &&
      !contentTypeKey && !contentIsFormData) {
    // For requests typically with form data, default to the url-encoded form
    // content type unless this is a FormData request.  For FormData,
    // the browser will automatically add a multipart/form-data content type
    // with an appropriate multipart boundary.
    headers.set(
        goog.net.XhrIo.CONTENT_TYPE_HEADER, goog.net.XhrIo.FORM_CONTENT_TYPE);
  }

  // Add the headers to the Xhr object
  for (const [key, value] of headers) {
    this.xhr_.setRequestHeader(key, value);
  }

  if (this.responseType_) {
    this.xhr_.responseType = this.responseType_;
  }
  // Set xhr_.withCredentials only when the value is different, or else in
  // synchronous XMLHtppRequest.open Firefox will throw an exception.
  // https://bugzilla.mozilla.org/show_bug.cgi?id=736340
  if ('withCredentials' in this.xhr_ &&
      this.xhr_.withCredentials !== this.withCredentials_) {
    /** @suppress {strictMissingProperties} Added to tighten compiler checks */
    this.xhr_.withCredentials = this.withCredentials_;
  }

  if ('setTrustToken' in this.xhr_ && this.trustToken_) {
    try {
      this.xhr_.setTrustToken(this.trustToken_);
    } catch (err) {
      goog.log.fine(
          this.logger_, this.formatMsg_('Error SetTrustToken: ' + err.message));
    }
  }
  /**
   * Try to send the request, or other wise report an error (404 not found).
   */
  try {
    this.cleanUpTimeoutTimer_();  // Paranoid, should never be running.
    if (this.timeoutInterval_ > 0) {
      this.useXhr2Timeout_ = goog.net.XhrIo.shouldUseXhr2Timeout_(this.xhr_);
      goog.log.fine(
          this.logger_,
          this.formatMsg_(
              'Will abort after ' + this.timeoutInterval_ +
              'ms if incomplete, xhr2 ' + this.useXhr2Timeout_));
      if (this.useXhr2Timeout_) {
        this.xhr_[goog.net.XhrIo.XHR2_TIMEOUT_] = this.timeoutInterval_;
        this.xhr_[goog.net.XhrIo.XHR2_ON_TIMEOUT_] =
            goog.bind(this.timeout_, this);
      } else {
        this.timeoutId_ =
            goog.Timer.callOnce(this.timeout_, this.timeoutInterval_, this);
      }
    }
    goog.log.fine(this.logger_, this.formatMsg_('Sending request'));
    this.inSend_ = true;
    this.xhr_.send(content);
    this.inSend_ = false;

  } catch (err) {
    goog.log.fine(this.logger_, this.formatMsg_('Send error: ' + err.message));
    this.error_(goog.net.ErrorCode.EXCEPTION, err);
  }
};


/**
 * Determines if the argument is an XMLHttpRequest that supports the level 2
 * timeout value and event.
 *
 * Currently, FF 21.0 OS X has the fields but won't actually call the timeout
 * handler.  Perhaps the confusion in the bug referenced below hasn't
 * entirely been resolved.
 *
 * @see http://www.w3.org/TR/XMLHttpRequest/#the-timeout-attribute
 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=525816
 *
 * @param {!goog.net.XhrLike.OrNative} xhr The request.
 * @return {boolean} True if the request supports level 2 timeout.
 * @private
 */
goog.net.XhrIo.shouldUseXhr2Timeout_ = function(xhr) {
  'use strict';
  return goog.userAgent.IE &&
      typeof xhr[goog.net.XhrIo.XHR2_TIMEOUT_] === 'number' &&
      xhr[goog.net.XhrIo.XHR2_ON_TIMEOUT_] !== undefined;
};


/**
 * Creates a new XHR object.
 * @return {!goog.net.XhrLike.OrNative} The newly created XHR object.
 * @protected
 */
goog.net.XhrIo.prototype.createXhr = function() {
  'use strict';
  return this.xmlHttpFactory_ ? this.xmlHttpFactory_.createInstance() :
                                goog.net.XmlHttp();
};


/**
 * The request didn't complete after {@link goog.net.XhrIo#timeoutInterval_}
 * milliseconds; raises a {@link goog.net.EventType.TIMEOUT} event and aborts
 * the request.
 * @private
 */
goog.net.XhrIo.prototype.timeout_ = function() {
  'use strict';
  if (typeof goog == 'undefined') {
    // If goog is undefined then the callback has occurred as the application
    // is unloading and will error.  Thus we let it silently fail.
  } else if (this.xhr_) {
    this.lastError_ =
        'Timed out after ' + this.timeoutInterval_ + 'ms, aborting';
    this.lastErrorCode_ = goog.net.ErrorCode.TIMEOUT;
    goog.log.fine(this.logger_, this.formatMsg_(this.lastError_));
    this.dispatchEvent(goog.net.EventType.TIMEOUT);
    this.abort(goog.net.ErrorCode.TIMEOUT);
  }
};


/**
 * Something errorred, so inactivate, fire error callback and clean up
 * @param {goog.net.ErrorCode} errorCode The error code.
 * @param {Error} err The error object.
 * @private
 */
goog.net.XhrIo.prototype.error_ = function(errorCode, err) {
  'use strict';
  this.active_ = false;
  if (this.xhr_) {
    this.inAbort_ = true;
    this.xhr_.abort();  // Ensures XHR isn't hung (FF)
    this.inAbort_ = false;
  }
  this.lastError_ = err;
  this.lastErrorCode_ = errorCode;
  this.dispatchErrors_();
  this.cleanUpXhr_();
};


/**
 * Dispatches COMPLETE and ERROR in case of an error. This ensures that we do
 * not dispatch multiple error events.
 * @private
 */
goog.net.XhrIo.prototype.dispatchErrors_ = function() {
  'use strict';
  if (!this.errorDispatched_) {
    this.errorDispatched_ = true;
    this.dispatchEvent(goog.net.EventType.COMPLETE);
    this.dispatchEvent(goog.net.EventType.ERROR);
  }
};


/**
 * Abort the current XMLHttpRequest
 * @param {goog.net.ErrorCode=} opt_failureCode Optional error code to use -
 *     defaults to ABORT.
 */
goog.net.XhrIo.prototype.abort = function(opt_failureCode) {
  'use strict';
  if (this.xhr_ && this.active_) {
    goog.log.fine(this.logger_, this.formatMsg_('Aborting'));
    this.active_ = false;
    this.inAbort_ = true;
    this.xhr_.abort();
    this.inAbort_ = false;
    this.lastErrorCode_ = opt_failureCode || goog.net.ErrorCode.ABORT;
    this.dispatchEvent(goog.net.EventType.COMPLETE);
    this.dispatchEvent(goog.net.EventType.ABORT);
    this.cleanUpXhr_();
  }
};


/**
 * Nullifies all callbacks to reduce risks of leaks.
 * @override
 * @protected
 */
goog.net.XhrIo.prototype.disposeInternal = function() {
  'use strict';
  if (this.xhr_) {
    // We explicitly do not call xhr_.abort() unless active_ is still true.
    // This is to avoid unnecessarily aborting a successful request when
    // dispose() is called in a callback triggered by a complete response, but
    // in which browser cleanup has not yet finished.
    // (See http://b/issue?id=1684217.)
    if (this.active_) {
      this.active_ = false;
      this.inAbort_ = true;
      this.xhr_.abort();
      this.inAbort_ = false;
    }
    this.cleanUpXhr_(true);
  }

  XhrIo.base(this, 'disposeInternal');
};


/**
 * Internal handler for the XHR object's readystatechange event.  This method
 * checks the status and the readystate and fires the correct callbacks.
 * If the request has ended, the handlers are cleaned up and the XHR object is
 * nullified.
 * @private
 */
goog.net.XhrIo.prototype.onReadyStateChange_ = function() {
  'use strict';
  if (this.isDisposed()) {
    // This method is the target of an untracked goog.Timer.callOnce().
    return;
  }
  if (!this.inOpen_ && !this.inSend_ && !this.inAbort_) {
    // Were not being called from within a call to this.xhr_.send
    // this.xhr_.abort, or this.xhr_.open, so this is an entry point
    this.onReadyStateChangeEntryPoint_();
  } else {
    this.onReadyStateChangeHelper_();
  }
};


/**
 * Used to protect the onreadystatechange handler entry point.  Necessary
 * as {#onReadyStateChange_} maybe called from within send or abort, this
 * method is only called when {#onReadyStateChange_} is called as an
 * entry point.
 * {@see #protectEntryPoints}
 * @private
 */
goog.net.XhrIo.prototype.onReadyStateChangeEntryPoint_ = function() {
  'use strict';
  this.onReadyStateChangeHelper_();
};


/**
 * Helper for {@link #onReadyStateChange_}.  This is used so that
 * entry point calls to {@link #onReadyStateChange_} can be routed through
 * {@link #onReadyStateChangeEntryPoint_}.
 * @private
 */
goog.net.XhrIo.prototype.onReadyStateChangeHelper_ = function() {
  'use strict';
  if (!this.active_) {
    // can get called inside abort call
    return;
  }

  if (typeof goog == 'undefined') {
    // NOTE(user): If goog is undefined then the callback has occurred as the
    // application is unloading and will error.  Thus we let it silently fail.

  } else if (
      this.xhrOptions_[goog.net.XmlHttp.OptionType.LOCAL_REQUEST_ERROR] &&
      this.getReadyState() == goog.net.XmlHttp.ReadyState.COMPLETE &&
      this.getStatus() == 2) {
    // NOTE(user): In IE if send() errors on a *local* request the readystate
    // is still changed to COMPLETE.  We need to ignore it and allow the
    // try/catch around send() to pick up the error.
    goog.log.fine(
        this.logger_,
        this.formatMsg_('Local request error detected and ignored'));

  } else {
    // In IE when the response has been cached we sometimes get the callback
    // from inside the send call and this usually breaks code that assumes that
    // XhrIo is asynchronous.  If that is the case we delay the callback
    // using a timer.
    if (this.inSend_ &&
        this.getReadyState() == goog.net.XmlHttp.ReadyState.COMPLETE) {
      goog.Timer.callOnce(this.onReadyStateChange_, 0, this);
      return;
    }

    this.dispatchEvent(goog.net.EventType.READY_STATE_CHANGE);

    // readyState indicates the transfer has finished
    if (this.isComplete()) {
      goog.log.fine(this.logger_, this.formatMsg_('Request complete'));

      this.active_ = false;

      try {
        // Call the specific callbacks for success or failure. Only call the
        // success if the status is 200 (HTTP_OK) or 304 (HTTP_CACHED)
        if (this.isSuccess()) {
          this.dispatchEvent(goog.net.EventType.COMPLETE);
          this.dispatchEvent(goog.net.EventType.SUCCESS);
        } else {
          this.lastErrorCode_ = goog.net.ErrorCode.HTTP_ERROR;
          this.lastError_ =
              this.getStatusText() + ' [' + this.getStatus() + ']';
          this.dispatchErrors_();
        }
      } finally {
        this.cleanUpXhr_();
      }
    }
  }
};


/**
 * Internal handler for the XHR object's onprogress event. Fires both a generic
 * PROGRESS event and either a DOWNLOAD_PROGRESS or UPLOAD_PROGRESS event to
 * allow specific binding for each XHR progress event.
 * @param {!ProgressEvent} e XHR progress event.
 * @param {boolean=} opt_isDownload Whether the current progress event is from a
 *     download. Used to determine whether DOWNLOAD_PROGRESS or UPLOAD_PROGRESS
 *     event should be dispatched.
 * @private
 */
goog.net.XhrIo.prototype.onProgressHandler_ = function(e, opt_isDownload) {
  'use strict';
  goog.asserts.assert(
      e.type === goog.net.EventType.PROGRESS,
      'goog.net.EventType.PROGRESS is of the same type as raw XHR progress.');
  this.dispatchEvent(
      goog.net.XhrIo.buildProgressEvent_(e, goog.net.EventType.PROGRESS));
  this.dispatchEvent(goog.net.XhrIo.buildProgressEvent_(
      e,
      opt_isDownload ? goog.net.EventType.DOWNLOAD_PROGRESS :
                       goog.net.EventType.UPLOAD_PROGRESS));
};


/**
 * Creates a representation of the native ProgressEvent. IE doesn't support
 * constructing ProgressEvent via "new", and the alternatives (e.g.,
 * ProgressEvent.initProgressEvent) are non-standard or deprecated.
 * @param {!ProgressEvent} e XHR progress event.
 * @param {!goog.net.EventType} eventType The type of the event.
 * @return {!ProgressEvent} The progress event.
 * @private
 */
goog.net.XhrIo.buildProgressEvent_ = function(e, eventType) {
  'use strict';
  return /** @type {!ProgressEvent} */ ({
    type: eventType,
    lengthComputable: e.lengthComputable,
    loaded: e.loaded,
    total: e.total,
  });
};


/**
 * Remove the listener to protect against leaks, and nullify the XMLHttpRequest
 * object.
 * @param {boolean=} opt_fromDispose If this is from the dispose (don't want to
 *     fire any events).
 * @private
 */
goog.net.XhrIo.prototype.cleanUpXhr_ = function(opt_fromDispose) {
  'use strict';
  if (this.xhr_) {
    // Cancel any pending timeout event handler.
    this.cleanUpTimeoutTimer_();

    // Save reference so we can mark it as closed after the READY event.  The
    // READY event may trigger another request, thus we must nullify this.xhr_
    const xhr = this.xhr_;
    const clearedOnReadyStateChange =
        this.xhrOptions_[goog.net.XmlHttp.OptionType.USE_NULL_FUNCTION] ?
        () => {} :
        null;
    this.xhr_ = null;
    this.xhrOptions_ = null;

    if (!opt_fromDispose) {
      this.dispatchEvent(goog.net.EventType.READY);
    }

    try {
      // NOTE(user): Not nullifying in FireFox can still leak if the callbacks
      // are defined in the same scope as the instance of XhrIo. But, IE doesn't
      // allow you to set the onreadystatechange to NULL so nullFunction is
      // used.
      xhr.onreadystatechange = clearedOnReadyStateChange;
    } catch (e) {
      // This seems to occur with a Gears HTTP request. Delayed the setting of
      // this onreadystatechange until after READY is sent out and catching the
      // error to see if we can track down the problem.
      goog.log.error(
          this.logger_,
          'Problem encountered resetting onreadystatechange: ' + e.message);
    }
  }
};


/**
 * Make sure the timeout timer isn't running.
 * @private
 */
goog.net.XhrIo.prototype.cleanUpTimeoutTimer_ = function() {
  'use strict';
  if (this.xhr_ && this.useXhr2Timeout_) {
    this.xhr_[goog.net.XhrIo.XHR2_ON_TIMEOUT_] = null;
  }
  if (this.timeoutId_) {
    goog.Timer.clear(this.timeoutId_);
    this.timeoutId_ = null;
  }
};


/**
 * @return {boolean} Whether there is an active request.
 */
goog.net.XhrIo.prototype.isActive = function() {
  'use strict';
  return !!this.xhr_;
};


/**
 * @return {boolean} Whether the request has completed.
 */
goog.net.XhrIo.prototype.isComplete = function() {
  'use strict';
  return this.getReadyState() == goog.net.XmlHttp.ReadyState.COMPLETE;
};


/**
 * @return {boolean} Whether the request completed with a success.
 */
goog.net.XhrIo.prototype.isSuccess = function() {
  'use strict';
  const status = this.getStatus();
  // A zero status code is considered successful for local files.
  return goog.net.HttpStatus.isSuccess(status) ||
      status === 0 && !this.isLastUriEffectiveSchemeHttp_();
};


/**
 * @return {boolean} whether the effective scheme of the last URI that was
 *     fetched was 'http' or 'https'.
 * @private
 */
goog.net.XhrIo.prototype.isLastUriEffectiveSchemeHttp_ = function() {
  'use strict';
  const scheme = goog.uri.utils.getEffectiveScheme(String(this.lastUri_));
  return HTTP_SCHEME_PATTERN.test(scheme);
};


/**
 * Get the readystate from the Xhr object
 * Will only return correct result when called from the context of a callback
 * @return {goog.net.XmlHttp.ReadyState} goog.net.XmlHttp.ReadyState.*.
 */
goog.net.XhrIo.prototype.getReadyState = function() {
  'use strict';
  return this.xhr_ ?
      /** @type {goog.net.XmlHttp.ReadyState} */ (this.xhr_.readyState) :
      goog.net.XmlHttp.ReadyState.UNINITIALIZED;
};


/**
 * Get the status from the Xhr object
 * Will only return correct result when called from the context of a callback
 * @return {number} Http status.
 */
goog.net.XhrIo.prototype.getStatus = function() {
  'use strict';
  /**
   * IE doesn't like you checking status until the readystate is greater than 2
   * (i.e. it is receiving or complete).  The try/catch is used for when the
   * page is unloading and an ERROR_NOT_AVAILABLE may occur when accessing xhr_.
   */
  try {
    return this.getReadyState() > goog.net.XmlHttp.ReadyState.LOADED ?
        this.xhr_.status :
        -1;
  } catch (e) {
    return -1;
  }
};


/**
 * Get the status text from the Xhr object
 * Will only return correct result when called from the context of a callback
 * @return {string} Status text.
 */
goog.net.XhrIo.prototype.getStatusText = function() {
  'use strict';
  /**
   * IE doesn't like you checking status until the readystate is greater than 2
   * (i.e. it is receiving or complete).  The try/catch is used for when the
   * page is unloading and an ERROR_NOT_AVAILABLE may occur when accessing xhr_.
   */
  try {
    return this.getReadyState() > goog.net.XmlHttp.ReadyState.LOADED ?
        this.xhr_.statusText :
        '';
  } catch (e) {
    goog.log.fine(this.logger_, 'Can not get status: ' + e.message);
    return '';
  }
};


/**
 * Get the last Uri that was requested
 * @return {string} Last Uri.
 */
goog.net.XhrIo.prototype.getLastUri = function() {
  'use strict';
  return String(this.lastUri_);
};


/**
 * Get the response text from the Xhr object
 * Will only return correct result when called from the context of a callback.
 * @return {string} Result from the server, or '' if no result available.
 */
goog.net.XhrIo.prototype.getResponseText = function() {
  'use strict';
  try {
    return this.xhr_ ? this.xhr_.responseText : '';
  } catch (e) {
    // http://www.w3.org/TR/XMLHttpRequest/#the-responsetext-attribute
    // states that responseText should return '' (and responseXML null)
    // when the state is not LOADING or DONE. Instead, IE can
    // throw unexpected exceptions, for example when a request is aborted
    // or no data is available yet.
    goog.log.fine(this.logger_, 'Can not get responseText: ' + e.message);
    return '';
  }
};


/**
 * Get the response body from the Xhr object. This property is only available
 * in IE since version 7 according to MSDN:
 * http://msdn.microsoft.com/en-us/library/ie/ms534368(v=vs.85).aspx
 * Will only return correct result when called from the context of a callback.
 *
 * One option is to construct a VBArray from the returned object and convert
 * it to a JavaScript array using the toArray method:
 * `(new window['VBArray'](xhrIo.getResponseBody())).toArray()`
 * This will result in an array of numbers in the range of [0..255]
 *
 * Another option is to use the VBScript CStr method to convert it into a
 * string as outlined in http://stackoverflow.com/questions/1919972
 *
 * @return {Object} Binary result from the server or null if not available.
 */
goog.net.XhrIo.prototype.getResponseBody = function() {
  'use strict';
  try {
    if (this.xhr_ && 'responseBody' in this.xhr_) {
      return this.xhr_['responseBody'];
    }
  } catch (e) {
    // IE can throw unexpected exceptions, for example when a request is aborted
    // or no data is yet available.
    goog.log.fine(this.logger_, 'Can not get responseBody: ' + e.message);
  }
  return null;
};


/**
 * Get the response XML from the Xhr object
 * Will only return correct result when called from the context of a callback.
 * @return {Document} The DOM Document representing the XML file, or null
 * if no result available.
 */
goog.net.XhrIo.prototype.getResponseXml = function() {
  'use strict';
  try {
    return this.xhr_ ? this.xhr_.responseXML : null;
  } catch (e) {
    goog.log.fine(this.logger_, 'Can not get responseXML: ' + e.message);
    return null;
  }
};


/**
 * Get the response and evaluates it as JSON from the Xhr object
 * Will only return correct result when called from the context of a callback
 * @param {string=} opt_xssiPrefix Optional XSSI prefix string to use for
 *     stripping of the response before parsing. This needs to be set only if
 *     your backend server prepends the same prefix string to the JSON response.
 * @throws Error if the response text is invalid JSON.
 * @return {Object|undefined} JavaScript object.
 */
goog.net.XhrIo.prototype.getResponseJson = function(opt_xssiPrefix) {
  'use strict';
  if (!this.xhr_) {
    return undefined;
  }

  let responseText = this.xhr_.responseText;
  if (opt_xssiPrefix && responseText.indexOf(opt_xssiPrefix) == 0) {
    responseText = responseText.substring(opt_xssiPrefix.length);
  }

  return goog.json.hybrid.parse(responseText);
};


/**
 * Get the response as the type specificed by {@link #setResponseType}. At time
 * of writing, this is only directly supported in very recent versions of WebKit
 * (10.0.612.1 dev and later). If the field is not supported directly, we will
 * try to emulate it.
 *
 * Emulating the response means following the rules laid out at
 * http://www.w3.org/TR/XMLHttpRequest/#the-response-attribute
 *
 * On browsers with no support for this (Chrome < 10, Firefox < 4, etc), only
 * response types of DEFAULT or TEXT may be used, and the response returned will
 * be the text response.
 *
 * On browsers with Mozilla's draft support for array buffers (Firefox 4, 5),
 * only response types of DEFAULT, TEXT, and ARRAY_BUFFER may be used, and the
 * response returned will be either the text response or the Mozilla
 * implementation of the array buffer response.
 *
 * On browsers will full support, any valid response type supported by the
 * browser may be used, and the response provided by the browser will be
 * returned.
 *
 * @return {*} The response.
 * @suppress {strictMissingProperties} Added to tighten compiler checks
 */
goog.net.XhrIo.prototype.getResponse = function() {
  'use strict';
  try {
    if (!this.xhr_) {
      return null;
    }
    if ('response' in this.xhr_) {
      return this.xhr_.response;
    }
    switch (this.responseType_) {
      case ResponseType.DEFAULT:
      case ResponseType.TEXT:
        return this.xhr_.responseText;
      // DOCUMENT and BLOB don't need to be handled here because they are
      // introduced in the same spec that adds the .response field, and would
      // have been caught above.
      // ARRAY_BUFFER needs an implementation for Firefox 4, where it was
      // implemented using a draft spec rather than the final spec.
      case ResponseType.ARRAY_BUFFER:
        if ('mozResponseArrayBuffer' in this.xhr_) {
          return this.xhr_.mozResponseArrayBuffer;
        }
    }
    // Fell through to a response type that is not supported on this browser.
    goog.log.error(
        this.logger_,
        'Response type ' + this.responseType_ + ' is not ' +
            'supported on this browser');
    return null;
  } catch (e) {
    goog.log.fine(this.logger_, 'Can not get response: ' + e.message);
    return null;
  }
};


/**
 * Get the value of the response-header with the given name from the Xhr object
 * Will only return correct result when called from the context of a callback
 * and the request has completed
 * @param {string} key The name of the response-header to retrieve.
 * @return {string|undefined} The value of the response-header named key.
 */
goog.net.XhrIo.prototype.getResponseHeader = function(key) {
  'use strict';
  if (!this.xhr_ || !this.isComplete()) {
    return undefined;
  }

  const value = this.xhr_.getResponseHeader(key);
  return value === null ? undefined : value;
};


/**
 * Gets the text of all the headers in the response.
 * Will only return correct result after ready state reaches `LOADED` (i.e.
 * `HEADERS_RECEIVED` as per MDN).
 * @return {string} The value of the response headers or empty string.
 */
goog.net.XhrIo.prototype.getAllResponseHeaders = function() {
  'use strict';
  // getAllResponseHeaders can return null if no response has been received,
  // ensure we always return an empty string.
  return this.xhr_ &&
          this.getReadyState() >= goog.net.XmlHttp.ReadyState.LOADED ?
      (this.xhr_.getAllResponseHeaders() || '') :
      '';
};


/**
 * Returns all response headers as a key-value map.
 * Multiple values for the same header key can be combined into one,
 * separated by a comma and a space.
 * Note that the native getResponseHeader method for retrieving a single header
 * does a case insensitive match on the header name. This method does not
 * include any case normalization logic, it will just return a key-value
 * representation of the headers.
 * See: http://www.w3.org/TR/XMLHttpRequest/#the-getresponseheader()-method
 * @return {!Object<string, string>} An object with the header keys as keys
 *     and header values as values.
 */
goog.net.XhrIo.prototype.getResponseHeaders = function() {
  'use strict';
  // TODO(user): Make this function parse headers as per the spec
  // (https://tools.ietf.org/html/rfc2616#section-4.2).

  const headersObject = {};
  const headersArray = this.getAllResponseHeaders().split('\r\n');
  for (let i = 0; i < headersArray.length; i++) {
    if (goog.string.isEmptyOrWhitespace(headersArray[i])) {
      continue;
    }
    const keyValue =
        goog.string.splitLimit(headersArray[i], ':', /* maxSplitCount= */ 1);
    const key = keyValue[0];
    let value = keyValue[1];

    if (typeof value !== 'string') {
      // There must be a value but it can be the empty string.
      continue;
    }

    // Whitespace at the start and end of the value is meaningless.
    value = value.trim();
    // The key should not contain whitespace but we currently ignore that.

    const values = headersObject[key] || [];
    headersObject[key] = values;
    values.push(value);
  }

  return goog.object.map(headersObject, function(values) {
    'use strict';
    return values.join(', ');
  });
};


/**
 * Get the value of the response-header with the given name from the Xhr object.
 * As opposed to {@link #getResponseHeader}, this method does not require that
 * the request has completed.
 * @param {string} key The name of the response-header to retrieve.
 * @return {?string} The value of the response-header, or null if it is
 *     unavailable.
 */
goog.net.XhrIo.prototype.getStreamingResponseHeader = function(key) {
  'use strict';
  return this.xhr_ ? this.xhr_.getResponseHeader(key) : null;
};


/**
 * Gets the text of all the headers in the response. As opposed to
 * {@link #getAllResponseHeaders}, this method does not require that the request
 * has completed.
 * @return {string} The value of the response headers or empty string.
 */
goog.net.XhrIo.prototype.getAllStreamingResponseHeaders = function() {
  'use strict';
  return this.xhr_ ? this.xhr_.getAllResponseHeaders() : '';
};


/**
 * Get the last error message
 * @return {!goog.net.ErrorCode} Last error code.
 */
goog.net.XhrIo.prototype.getLastErrorCode = function() {
  'use strict';
  return this.lastErrorCode_;
};


/**
 * Get the last error message
 * @return {string} Last error message.
 */
goog.net.XhrIo.prototype.getLastError = function() {
  'use strict';
  return typeof this.lastError_ === 'string' ? this.lastError_ :
                                               String(this.lastError_);
};


/**
 * Adds the last method, status and URI to the message.  This is used to add
 * this information to the logging calls.
 * @param {string} msg The message text that we want to add the extra text to.
 * @return {string} The message with the extra text appended.
 * @private
 */
goog.net.XhrIo.prototype.formatMsg_ = function(msg) {
  'use strict';
  return msg + ' [' + this.lastMethod_ + ' ' + this.lastUri_ + ' ' +
      this.getStatus() + ']';
};


// Register the xhr handler as an entry point, so that
// it can be monitored for exception handling, etc.
goog.debug.entryPointRegistry.register(
    /**
     * @param {function(!Function): !Function} transformer The transforming
     *     function.
     */
    function(transformer) {
      'use strict';
      goog.net.XhrIo.prototype.onReadyStateChangeEntryPoint_ =
          transformer(goog.net.XhrIo.prototype.onReadyStateChangeEntryPoint_);
    });
});  // goog.scope


// goog/net/cookies.js

/**
 * @fileoverview Functions for setting, getting and deleting cookies.
 */


goog.provide('goog.net.Cookies');




/**
 * A class for handling browser cookies.
 * @param {?Document} context The context document to get/set cookies on.
 * @constructor
 * @final
 */
goog.net.Cookies = function(context) {
  'use strict';
  /**
   * The context document to get/set cookies on. If no document context is
   * passed, use a fake one with only the "cookie" attribute. This allows
   * this class to be instantiated safely in web worker environments.
   * @private {{cookie: string}}
   */
  this.document_ = context || {cookie: ''};
};


/**
 * Static constant for the size of cookies. Per the spec, there's a 4K limit
 * to the size of a cookie. To make sure users can't break this limit, we
 * should truncate long cookies at 3950 bytes, to be extra careful with dumb
 * browsers/proxies that interpret 4K as 4000 rather than 4096.
 * @const {number}
 */
goog.net.Cookies.MAX_COOKIE_LENGTH = 3950;


/**
 * The name of the test cookie to set.
 *
 *
 * @private @const {string}
 */
goog.net.Cookies.TEST_COOKIE_NAME_ = 'TESTCOOKIESENABLED';


/**
 * The value of the test cookie to set.
 * @private @const {string}
 */
goog.net.Cookies.TEST_COOKIE_VALUE_ = '1';


/**
 * Max age of the test cookie in seconds.
 * @private @const {number}
 */
goog.net.Cookies.TEST_COOKIE_MAX_AGE_ = 60;


/**
 * Returns true if cookies are enabled.
 *
 * navigator.cookieEnabled is an unreliable API in some browsers such as
 * Internet Explorer. It will return true even when cookies are actually
 * blocked. To work around this, check for the presence of cookies, or attempt
 * to manually set and retrieve a cookie, which is the ultimate test of whether
 * or not a browser supports cookies.
 *
 * @return {boolean} True if cookies are enabled.
 */
goog.net.Cookies.prototype.isEnabled = function() {
  'use strict';
  if (!goog.global.navigator.cookieEnabled) {
    return false;
  }

  if (!this.isEmpty()) {
    // There are some cookies already set for the current domain, so cookies
    // can't be totally blocked.
    return true;
  }

  // Try setting and reading back a cookie to see if cookies are enabled.
  this.set(
      goog.net.Cookies.TEST_COOKIE_NAME_, goog.net.Cookies.TEST_COOKIE_VALUE_,
      {maxAge: goog.net.Cookies.TEST_COOKIE_MAX_AGE_});
  if (this.get(goog.net.Cookies.TEST_COOKIE_NAME_) !==
      goog.net.Cookies.TEST_COOKIE_VALUE_) {
    return false;
  }

  // Clean up the test cookie.
  this.remove(goog.net.Cookies.TEST_COOKIE_NAME_);

  return true;
};


/**
 * We do not allow '=', ';', or white space in the name.
 *
 * NOTE: The following are allowed by this method, but should be avoided for
 * cookies handled by the server.
 * - any name starting with '$'
 * - 'Comment'
 * - 'Domain'
 * - 'Expires'
 * - 'Max-Age'
 * - 'Path'
 * - 'Secure'
 * - 'Version'
 *
 * @param {string} name Cookie name.
 * @return {boolean} Whether name is valid.
 *
 * @see <a href="http://tools.ietf.org/html/rfc2109">RFC 2109</a>
 * @see <a href="http://tools.ietf.org/html/rfc2965">RFC 2965</a>
 */
goog.net.Cookies.prototype.isValidName = function(name) {
  'use strict';
  return !(/[;=\s]/.test(name));
};


/**
 * We do not allow ';' or line break in the value.
 *
 * Spec does not mention any illegal characters, but in practice semi-colons
 * break parsing and line breaks truncate the name.
 *
 * @param {string} value Cookie value.
 * @return {boolean} Whether value is valid.
 *
 * @see <a href="http://tools.ietf.org/html/rfc2109">RFC 2109</a>
 * @see <a href="http://tools.ietf.org/html/rfc2965">RFC 2965</a>
 */
goog.net.Cookies.prototype.isValidValue = function(value) {
  'use strict';
  return !(/[;\r\n]/.test(value));
};


/**
 * Sets a cookie.  The max_age can be -1 to set a session cookie. To remove and
 * expire cookies, use remove() instead.
 *
 * Neither the `name` nor the `value` are encoded in any way. It is
 * up to the callers of `get` and `set` (as well as all the other
 * methods) to handle any possible encoding and decoding.
 *
 * @throws {!Error} If the `name` fails #goog.net.cookies.isValidName.
 * @throws {!Error} If the `value` fails #goog.net.cookies.isValidValue.
 *
 * @param {string} name  The cookie name.
 * @param {string} value  The cookie value.
 * @param {!goog.net.Cookies.SetOptions=} options  The options object.
 */
goog.net.Cookies.prototype.set = function(name, value, options) {
  'use strict';
  /** @type {number|undefined} */
  let maxAge;
  /** @type {string|undefined} */
  let path;
  /** @type {string|undefined} */
  let domain;
  /** @type {boolean} */
  let secure = false;
  /** @type {!goog.net.Cookies.SameSite|undefined} */
  let sameSite;

  if (typeof options === 'object') {
    sameSite = options.sameSite;
    secure = options.secure || false;
    domain = options.domain || undefined;
    path = options.path || undefined;
    maxAge = options.maxAge;
  }
  if (!this.isValidName(name)) {
    throw new Error('Invalid cookie name "' + name + '"');
  }
  if (!this.isValidValue(value)) {
    throw new Error('Invalid cookie value "' + value + '"');
  }

  if (maxAge === undefined) {
    maxAge = -1;
  }

  const domainStr = domain ? ';domain=' + domain : '';
  const pathStr = path ? ';path=' + path : '';
  const secureStr = secure ? ';secure' : '';

  let expiresStr;

  // Case 1: Set a session cookie.
  if (maxAge < 0) {
    expiresStr = '';

    // Case 2: Remove the cookie.
    // Note: We don't tell people about this option in the function doc because
    // we prefer people to use remove() to remove cookies.
  } else if (maxAge == 0) {
    // Note: Don't use Jan 1, 1970 for date because NS 4.76 will try to convert
    // it to local time, and if the local time is before Jan 1, 1970, then the
    // browser will ignore the Expires attribute altogether.
    const pastDate = new Date(1970, 1 /*Feb*/, 1);  // Feb 1, 1970
    expiresStr = ';expires=' + pastDate.toUTCString();

    // Case 3: Set a persistent cookie.
  } else {
    const futureDate = new Date(Date.now() + maxAge * 1000);
    expiresStr = ';expires=' + futureDate.toUTCString();
  }

  const sameSiteStr = sameSite != null ? ';samesite=' + sameSite : '';

  this.setCookie_(
      name + '=' + value + domainStr + pathStr + expiresStr + secureStr +
      sameSiteStr);
};


/**
 * Returns the value for the first cookie with the given name.
 * @param {string} name  The name of the cookie to get.
 * @param {string=} opt_default  If not found this is returned instead.
 * @return {string|undefined}  The value of the cookie. If no cookie is set this
 *     returns opt_default or undefined if opt_default is not provided.
 */
goog.net.Cookies.prototype.get = function(name, opt_default) {
  'use strict';
  const nameEq = name + '=';
  const parts = this.getParts_();
  for (let i = 0, part; i < parts.length; i++) {
    part = goog.string.trim(parts[i]);
    // startsWith
    if (part.lastIndexOf(nameEq, 0) == 0) {
      return part.slice(nameEq.length);
    }
    if (part == name) {
      return '';
    }
  }
  return opt_default;
};


/**
 * Removes and expires a cookie.
 * @param {string} name  The cookie name.
 * @param {?string=} opt_path  The path of the cookie. If null or not present,
 *     expires the cookie set at the full request path.
 * @param {?string=} opt_domain  The domain of the cookie, or null to expire a
 *     cookie set at the full request host name. If not provided, the default is
 *     null (i.e. cookie at full request host name).
 * @return {boolean} Whether the cookie existed before it was removed.
 */
goog.net.Cookies.prototype.remove = function(name, opt_path, opt_domain) {
  'use strict';
  const rv = this.containsKey(name);
  this.set(name, '', {maxAge: 0, path: opt_path, domain: opt_domain});
  return rv;
};


/**
 * Gets the names for all the cookies.
 * @return {!Array<string>} An array with the names of the cookies.
 */
goog.net.Cookies.prototype.getKeys = function() {
  'use strict';
  return this.getKeyValues_().keys;
};


/**
 * Gets the values for all the cookies.
 * @return {!Array<string>} An array with the values of the cookies.
 */
goog.net.Cookies.prototype.getValues = function() {
  'use strict';
  return this.getKeyValues_().values;
};


/**
 * @return {boolean} Whether there are any cookies for this document.
 */
goog.net.Cookies.prototype.isEmpty = function() {
  'use strict';
  return !this.getCookie_();
};


/**
 * @return {number} The number of cookies for this document.
 */
goog.net.Cookies.prototype.getCount = function() {
  'use strict';
  const cookie = this.getCookie_();
  if (!cookie) {
    return 0;
  }
  return this.getParts_().length;
};


/**
 * Returns whether there is a cookie with the given name.
 * @param {string} key The name of the cookie to test for.
 * @return {boolean} Whether there is a cookie by that name.
 */
goog.net.Cookies.prototype.containsKey = function(key) {
  'use strict';
  // substring will return empty string if the key is not found, so the get
  // function will only return undefined
  return this.get(key) !== undefined;
};


/**
 * Returns whether there is a cookie with the given value. (This is an O(n)
 * operation.)
 * @param {string} value  The value to check for.
 * @return {boolean} Whether there is a cookie with that value.
 */
goog.net.Cookies.prototype.containsValue = function(value) {
  'use strict';
  // this O(n) in any case so lets do the trivial thing.
  const values = this.getKeyValues_().values;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == value) {
      return true;
    }
  }
  return false;
};


/**
 * Removes all cookies for this document.  Note that this will only remove
 * cookies from the current path and domain.  If there are cookies set using a
 * subpath and/or another domain these will still be there.
 */
goog.net.Cookies.prototype.clear = function() {
  'use strict';
  const keys = this.getKeyValues_().keys;
  for (let i = keys.length - 1; i >= 0; i--) {
    this.remove(keys[i]);
  }
};


/**
 * Private helper function to allow testing cookies without depending on the
 * browser.
 * @param {string} s The cookie string to set.
 * @private
 */
goog.net.Cookies.prototype.setCookie_ = function(s) {
  'use strict';
  this.document_.cookie = s;
};


/**
 * Private helper function to allow testing cookies without depending on the
 * browser. IE6 can return null here.
 * @return {string} Returns the `document.cookie`.
 * @private
 */
goog.net.Cookies.prototype.getCookie_ = function() {
  'use strict';
  return this.document_.cookie;
};


/**
 * @return {!Array<string>} The cookie split on semi colons.
 * @private
 */
goog.net.Cookies.prototype.getParts_ = function() {
  'use strict';
  return (this.getCookie_() || '').split(';');
};


/**
 * Gets the names and values for all the cookies.
 * @return {{keys:!Array<string>, values:!Array<string>}} An object with keys
 *     and values.
 * @private
 */
goog.net.Cookies.prototype.getKeyValues_ = function() {
  'use strict';
  const parts = this.getParts_();
  const keys = [];
  const values = [];
  let index;
  let part;
  for (let i = 0; i < parts.length; i++) {
    part = goog.string.trim(parts[i]);
    index = part.indexOf('=');

    if (index == -1) {  // empty name
      keys.push('');
      values.push(part);
    } else {
      keys.push(part.substring(0, index));
      values.push(part.substring(index + 1));
    }
  }
  return {keys: keys, values: values};
};


/**
 * Options object for calls to Cookies.prototype.set.
 * @record
 */
goog.net.Cookies.SetOptions = function() {
  'use strict';
  /**
   * The max age in seconds (from now). Use -1 to set a session cookie. If not
   * provided, the default is -1 (i.e. set a session cookie).
   * @type {number|undefined}
   */
  this.maxAge;
  /**
   * The path of the cookie. If not present then this uses the full request
   * path.
   * @type {?string|undefined}
   */
  this.path;
  /**
   * The domain of the cookie, or null to not specify a domain attribute
   * (browser will use the full request host name). If not provided, the default
   * is null (i.e. let browser use full request host name).
   * @type {?string|undefined}
   */
  this.domain;
  /**
   * Whether the cookie should only be sent over a secure channel.
   * @type {boolean|undefined}
   */
  this.secure;
  /**
   * The SameSite attribute for the cookie (default is NONE).
   * @type {!goog.net.Cookies.SameSite|undefined}
   */
  this.sameSite;
};


/**
 * Valid values for the SameSite cookie attribute.  In 2019, browsers began the
 * process of changing the default from NONE to LAX.
 *
 * @see https://web.dev/samesite-cookies-explained
 * @see https://tools.ietf.org/html/draft-ietf-httpbis-rfc6265bis-03#section-5.3.7
 * @enum {string}
 */
goog.net.Cookies.SameSite = {
  /**
   * The cookie will be sent in first-party contexts, including initial
   * navigation from external referrers.
   */
  LAX: 'lax',
  /**
   * The cookie will be sent in all first-party or third-party contexts. This
   * was the original default behavior of the web, but will need to be set
   * explicitly starting in 2020.
   */
  NONE: 'none',
  /**
   * The cookie will only be sent in first-party contexts. It will not be sent
   * on initial navigation from external referrers.
   */
  STRICT: 'strict',
};

/**
 * A static default instance.
 * @const {!goog.net.Cookies}
 * @private
 */
goog.net.Cookies.instance_ =
    new goog.net.Cookies(typeof document == 'undefined' ? null : document);

/**
 * Getter for the static instance of goog.net.Cookies.
 * @return {!goog.net.Cookies}
 */
goog.net.Cookies.getInstance = function() {
  'use strict';
  return goog.net.Cookies.instance_;
};

// goog.net.Jsonp, written for this module: the Closure Library's loads a
// goog.html.TrustedResourceUrl with goog.net.jsloader and throws for the URL
// strings ClojureScript libraries (cljs-http) pass it. This one takes either:
// the payload and the callback parameter are added to a string's query.
goog.provide('goog.net.Jsonp');

goog.net.Jsonp = function(uri, opt_callbackParamName) {
  this.uri_ = uri;
  this.callbackParamName_ = opt_callbackParamName ? opt_callbackParamName : 'callback';
  this.timeout_ = 5000;
  this.nonce_ = '';
};

goog.net.Jsonp.CALLBACKS = '_callbacks_';

goog.net.Jsonp.scriptCounter_ = 0;

goog.net.Jsonp.getCallbackId_ = (id) => goog.net.Jsonp.CALLBACKS + '__' + id;

goog.net.Jsonp.prototype.setRequestTimeout = function(timeout) {
  this.timeout_ = timeout;
};

goog.net.Jsonp.prototype.getRequestTimeout = function() {
  return this.timeout_;
};

goog.net.Jsonp.prototype.setNonce = function(nonce) {
  this.nonce_ = nonce;
};

goog.net.Jsonp.prototype.send = function(opt_payload, opt_replyCallback, opt_errorCallback, opt_callbackParamValue) {
  const payload = opt_payload ? Object.assign({}, opt_payload) : {};
  const id = opt_callbackParamValue ||
      '_' + (goog.net.Jsonp.scriptCounter_++).toString(36) + Date.now().toString(36);
  const callbackId = goog.net.Jsonp.getCallbackId_(id);
  if (opt_replyCallback) {
    goog.global[callbackId] = function(...args) {
      goog.net.Jsonp.cleanup_(id, true);
      opt_replyCallback.apply(undefined, args);
    };
    payload[this.callbackParamName_] = callbackId;
  }
  let src;
  if (typeof this.uri_.cloneWithParams === 'function') {
    src = String(this.uri_.cloneWithParams(payload));
  } else {
    const url = new URL(String(this.uri_), goog.global.location && goog.global.location.href);
    for (const key in payload) url.searchParams.set(key, payload[key]);
    src = url.href;
  }
  const script = goog.global.document.createElement('script');
  if (this.nonce_) script.setAttribute('nonce', this.nonce_);
  const request = { id_: id, script_: script, timer_: null };
  const done = () => {
    clearTimeout(request.timer_);
    script.remove();
  };
  const fail = () => {
    done();
    goog.net.Jsonp.cleanup_(id, false);
    if (opt_errorCallback) opt_errorCallback(payload);
  };
  script.onload = done;
  script.onerror = fail;
  if (this.timeout_ > 0) request.timer_ = setTimeout(fail, this.timeout_);
  script.src = src;
  goog.global.document.head.appendChild(script);
  return request;
};

goog.net.Jsonp.prototype.cancel = function(request) {
  if (request) {
    if (request.script_) {
      clearTimeout(request.timer_);
      request.script_.onload = request.script_.onerror = null;
      request.script_.remove();
    }
    if (request.id_) goog.net.Jsonp.cleanup_(request.id_, false);
  }
};

goog.net.Jsonp.cleanup_ = function(id, deleteReplyHandler) {
  const callbackId = goog.net.Jsonp.getCallbackId_(id);
  if (goog.global[callbackId]) {
    if (deleteReplyHandler) {
      delete goog.global[callbackId];
    } else {
      // a reply arriving later finds a function that does nothing
      goog.global[callbackId] = () => undefined;
    }
  }
};

const XhrIo$ = goog.net.XhrIo;
const Jsonp$ = goog.net.Jsonp;
const Cookies$ = goog.net.Cookies;
const cookies$ = goog.net.cookies;
const EventType$ = goog.net.EventType;
const ErrorCode$ = goog.net.ErrorCode;
const HttpStatus$ = goog.net.HttpStatus;
const XmlHttp$ = goog.net.XmlHttp;
export {
  XhrIo$ as XhrIo,
  Jsonp$ as Jsonp,
  Cookies$ as Cookies,
  cookies$ as cookies,
  EventType$ as EventType,
  ErrorCode$ as ErrorCode,
  HttpStatus$ as HttpStatus,
  XmlHttp$ as XmlHttp,
};
