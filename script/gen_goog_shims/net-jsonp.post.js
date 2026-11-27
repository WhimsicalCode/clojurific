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
