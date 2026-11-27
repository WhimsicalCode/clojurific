// Copyright 2014 Cognitect. All Rights Reserved.
// Licensed under the Apache License, Version 2.0
//
// transit-js 0.8.874 as an ES module, mechanically converted from its sources
// by running them against a module-local goog whose goog.math.Long and
// goog.object are the shims': large integers are cljs.core's goog.math.Long.
// com.cognitect.transit, com.cognitect.transit.types and
// com.cognitect.transit.eq re-export its namespaces' members.

import { typeOf } from '../../goog.js';
import { Long } from '../../goog/math.js';
import * as object from '../../goog/object.js';

const TRANSIT_DEV = false, TRANSIT_NODE_TARGET = false, TRANSIT_BROWSER_TARGET = false;
const com = {};
const goog = {
  global: globalThis,
  typeOf,
  math: { Long },
  object,
  scope(fn) { fn.call(globalThis); },
  provide(name) {
    const parts = name.split('.');
    let cur = parts[0] === 'com' ? com : goog;
    for (const p of parts.slice(1)) cur = cur[p] ??= {};
  },
  exportSymbol() {},
};

// com/cognitect/transit/util.js

goog.provide("com.cognitect.transit.util");

goog.scope(function () {

    var util    = com.cognitect.transit.util,
        gobject = goog.object;

    if (typeof Object.keys != "undefined") {
        util.objectKeys = function (obj) {
            return Object.keys(obj);
        };
    } else {
        util.objectKeys = function (obj) {
            return gobject.getKeys(obj);
        };
    }

    if (typeof Array.isArray != "undefined") {
        util.isArray = function (obj) {
            return Array.isArray(obj);
        };
    } else {
        util.isArray = function (obj) {
            return goog.typeOf(obj) === "array";
        };
    }

    /**
     * @const
     * @type {string}
     */
    util.chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

    util.randInt = function (ub) {
        return Math.round(Math.random() * ub);
    };

    util.randHex = function () {
        return util.randInt(15).toString(16);
    };

    util.randomUUID = function () {
        var rhex = (0x8 | (0x3 & util.randInt(14))).toString(16),
            ret  = util.randHex() + util.randHex() + util.randHex() + util.randHex() +
                   util.randHex() + util.randHex() + util.randHex() + util.randHex() + "-" +
                   util.randHex() + util.randHex() + util.randHex() + util.randHex() + "-" +
                              "4" + util.randHex() + util.randHex() + util.randHex() + "-" +
                             rhex + util.randHex() + util.randHex() + util.randHex() + "-" +
                   util.randHex() + util.randHex() + util.randHex() + util.randHex() +
                   util.randHex() + util.randHex() + util.randHex() + util.randHex() +
                   util.randHex() + util.randHex() + util.randHex() + util.randHex();
        return ret;
    };

// https://github.com/davidchambers/Base64.js

    util.btoa = function (input) {
        if (typeof btoa != "undefined") {
            return btoa(input);
        } else {
            var str = String(input);
            for (
                var block, charCode, idx = 0, map = util.chars, output = '';
                str.charAt(idx | 0) || (map = '=', idx % 1);
                output += map.charAt(63 & block >> 8 - idx % 1 * 8)
            ) {
                charCode = str.charCodeAt(idx += 3 / 4);
                if (charCode > 0xFF) {
                    throw new Error("'btoa' failed: The string to be encoded contains characters outside of the Latin1 range.");
                }
                block = block << 8 | charCode;
            }
            return output;
        }
    };

    /**
     * @suppress {uselessCode}
     */
    util.atob = function (input) {
        if (typeof atob != "undefined") {
            return atob(input);
        } else {
            var str = String(input).replace(/=+$/, '');
            if (str.length % 4 == 1) {
                throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");
            }
            for (
                var bc = 0, bs, buffer, idx = 0, output = '';
                buffer = str.charAt(idx++);
                ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer,
                bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0
            ) {
                buffer = util.chars.indexOf(buffer);
            }
            return output;
        }
    };

    util.Uint8ToBase64 = function (u8Arr) {
        var CHUNK_SIZE = 0x8000,
            index      = 0,
            length     = u8Arr.length,
            result     = '',
            slice      = null;

        while (index < length) {
            slice = u8Arr.subarray(index, Math.min(index + CHUNK_SIZE, length));
            result += String.fromCharCode.apply(null, slice);
            index += CHUNK_SIZE;
        }

        return util.btoa(result);
    };

    util.Base64ToUint8 = function (base64) {
        var binary_string = util.atob(base64),
            len           = binary_string.length,
            bytes         = new Uint8Array(len);

        for (var i = 0; i < len; i++) {
            var ascii = binary_string.charCodeAt(i);
            bytes[i] = ascii;
        }

        return bytes;
    };

});

// com/cognitect/transit/delimiters.js

goog.provide("com.cognitect.transit.delimiters");

goog.scope(function() {

var delimiters = com.cognitect.transit.delimiters;
    
/**
 * @const
 * @type {string}
 */
delimiters.ESC     = "~";

/**
 * @const
 * @type {string}
 */
delimiters.TAG     = "#";

/**
 * @const
 * @type {string}
 */
delimiters.SUB     = "^";

/**
 * @const
 * @type {string}
 */
delimiters.RES     = "`";

/**
 * @const
 * @type {string}
 */
delimiters.ESC_TAG = "~#";

});

// com/cognitect/transit/caching.js

goog.provide("com.cognitect.transit.caching");

goog.scope(function() {

var caching = com.cognitect.transit.caching,
    d       = com.cognitect.transit.delimiters;

/**
 * @const
 * @type {number}
 */
caching.MIN_SIZE_CACHEABLE = 3;

/**
 * @const
 * @type {number}
 */
caching.BASE_CHAR_IDX = 48;

/**
 * @const
 * @type {number}
 */
caching.CACHE_CODE_DIGITS = 44;

/**
 * @const
 * @type {number}
 */
caching.MAX_CACHE_ENTRIES = caching.CACHE_CODE_DIGITS*caching.CACHE_CODE_DIGITS;

/**
 * @const
 * @type {number}
 */
caching.MAX_CACHE_SIZE = 4096;

caching.isCacheable = function(string, asMapKey) {
    if(string.length > caching.MIN_SIZE_CACHEABLE) {
        if(asMapKey) {
            return true;
        } else {
            var c0 = string.charAt(0),
                c1 = string.charAt(1);
            if(c0 === d.ESC) {
                return c1 === ":" || c1 === "$" || c1 === "#";
            } else {
                return false;
            }
        }
    } else {
        return false;
    }
};

// =============================================================================
// WriteCache

caching.idxToCode = function(idx) {
    var hi  = Math.floor(idx / caching.CACHE_CODE_DIGITS),
        lo  = idx % caching.CACHE_CODE_DIGITS,
        loc = String.fromCharCode(lo + caching.BASE_CHAR_IDX)
    if(hi === 0) {
        return d.SUB + loc;
    } else {
        return d.SUB + String.fromCharCode(hi + caching.BASE_CHAR_IDX) + loc;
    }
};

/**
 * @constructor
 */
caching.WriteCache = function() {
    this.idx = 0;
    this.gen = 0;
    this.cacheSize = 0;
    this.cache = {};
};

caching.WriteCache.prototype.write = function(string, asMapKey) {
    if(caching.isCacheable(string, asMapKey)) {
        if(this.cacheSize === caching.MAX_CACHE_SIZE) {
            this.clear();
            this.gen = 0;
            this.cache = {};
        } else if(this.idx === caching.MAX_CACHE_ENTRIES) {
            this.clear();
        }
        var entry = this.cache[string];
        if(entry == null) {
            this.cache[string] = [caching.idxToCode(this.idx), this.gen];
            this.idx++;
            return string;
        } else if(entry[1] != this.gen) {
            entry[1] = this.gen;
            entry[0] = caching.idxToCode(this.idx);
            this.idx++;
            return string;
        } else {
            return entry[0];
        }
    } else {
        return string;
    }
};

caching.WriteCache.prototype.clear = function Transit$WriteCache() {
    this.idx = 0;
    this.gen++;
};

caching.writeCache = function() {
    return new caching.WriteCache();
};

// =============================================================================
// ReadCache

caching.isCacheCode = function(string) {
    return (string.charAt(0) === d.SUB) && (string.charAt(1) !== " ");
};

caching.codeToIdx = function(code) {
    if(code.length === 2) {
        return code.charCodeAt(1) - caching.BASE_CHAR_IDX;        
    } else {
        var hi = (code.charCodeAt(1) - caching.BASE_CHAR_IDX) * caching.CACHE_CODE_DIGITS,
            lo = (code.charCodeAt(2) - caching.BASE_CHAR_IDX);
        return hi + lo; 
    }
};

/**
 * @constructor
 */
caching.ReadCache = function Transit$ReadCache() {
    this.idx = 0;
    this.cache = [];
};

caching.ReadCache.prototype.write = function(obj, asMapKey) {
    if(this.idx == caching.MAX_CACHE_ENTRIES) {
        this.idx = 0;
    }
    this.cache[this.idx] = obj;
    this.idx++;
    return obj;
};

caching.ReadCache.prototype.read = function(string, asMapKey) {
    return this.cache[caching.codeToIdx(string)];
};

caching.ReadCache.prototype.clear = function() {
    this.idx = 0;
};

caching.readCache = function() {
    return new caching.ReadCache();
};

});    

// com/cognitect/transit/eq.js

goog.provide("com.cognitect.transit.eq");

goog.scope(function() {

var eq   = com.cognitect.transit.eq,
    util = com.cognitect.transit.util;

/**
 * @const
 * @type {string}
 */
eq.hashCodeProperty = "transit$hashCode$";

/**
 * @type {number}
 */
eq.hashCodeCounter = 1;

eq.equals = function (x, y) {
    if(x == null) {
        return y == null;
    } else if(x === y) {
        return true;
    } else if(typeof x === "object") {
        if(util.isArray(x)) {
            if(util.isArray(y)) {
                if(x.length === y.length) {
                    for(var i = 0; i < x.length; i++) {
                        if(!eq.equals(x[i], y[i])) {
                            return false;
                        }
                    }
                    return true;
                } else {
                    return false;
                }
            } else {
                return false;
            }
        } else if(x.com$cognitect$transit$equals) {
            return x.com$cognitect$transit$equals(y);
        } else if((y != null) && (typeof y === "object")) {
            if(y.com$cognitect$transit$equals) {
                return y.com$cognitect$transit$equals(x);
            } else {
                var xklen = 0,
                    yklen = util.objectKeys(y).length;
                for(var p in x) {
                    if(!x.hasOwnProperty(p)) continue;
                    xklen++;
                    if(!y.hasOwnProperty(p)) {
                        return false;
                    } else {
                        if(!eq.equals(x[p], y[p])) {
                            return false;
                        }
                    }
                }
                return xklen === yklen;
            }
        } else {
            return false;
        }
    } else {
        return false
    }
};

eq.hashCombine = function(seed, hash) {
    return seed ^ (hash + 0x9e3779b9 + (seed << 6) + (seed >> 2));
};

eq.stringCodeCache     = {};
eq.stringCodeCacheSize = 0;

/**
 * @const
 * @type {number}
 */
eq.STR_CACHE_MAX       = 256;

eq.hashString = function(str) {
    // a la goog.string.HashCode
    // http://docs.closure-library.googlecode.com/git/local_closure_goog_string_string.js.source.html#line1206
    var cached = eq.stringCodeCache[str];
    if(cached != null) {
        return cached;
    }
    var code = 0;
    for (var i = 0; i < str.length; ++i) {
        code = 31 * code + str.charCodeAt(i);
        code %= 0x100000000;
    }
    eq.stringCodeCacheSize++;
    if(eq.stringCodeCacheSize >= eq.STR_CACHE_MAX) {
        eq.stringCodeCache = {};
        eq.stringCodeCacheSize = 1;
    }
    eq.stringCodeCache[str] = code;
    return code;
};

eq.hashMapLike = function(m) {
    var code = 0;
    // ES6 Map-like case
    if(m.forEach != null) {
        m.forEach(function(val, key, m) {
            code = (code + (eq.hashCode(key) ^ eq.hashCode(val))) % 4503599627370496;
        });
    } else {
        // JS Object case
        var keys = util.objectKeys(m);
        for(var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var val = m[key];
            code = (code + (eq.hashCode(key) ^ eq.hashCode(val))) % 4503599627370496;
        }
    }
    return code;
};

eq.hashArrayLike = function(arr) {
    var code = 0;
    if(util.isArray(arr)) {
        for(var i = 0; i < arr.length; i++) {
            code = eq.hashCombine(code, eq.hashCode(arr[i]));
        }
    } else if(arr.forEach) {
        arr.forEach(function(x, i) {
            code = eq.hashCombine(code, eq.hashCode(x));
        });
    }
    return code;
};

eq.hashCode = function(x) {
    if(x == null) {
        return 0;
    } else {
        switch(typeof x) {
        case 'number':
            return x;
            break;
        case 'boolean':
            return x === true ? 1 : 0;
            break;
        case 'string':
            return eq.hashString(x);
            break;
        case 'function':
            var code = x[eq.hashCodeProperty];
            if(code) {
                return code;
            } else {
                code = eq.hashCodeCounter;
                if(typeof Object.defineProperty != "undefined") {
                    Object.defineProperty(x, eq.hashCodeProperty, {
                        value: code,
                        enumerable: false
                    });
                } else {
                    x[eq.hashCodeProperty] = code;
                }
                eq.hashCodeCounter++;    
                return code;
            }
            break;
        default:
            if(x instanceof Date) {
                return x.valueOf();
            } else if(util.isArray(x)) {
                return eq.hashArrayLike(x);
            } if(x.com$cognitect$transit$hashCode) {
                return x.com$cognitect$transit$hashCode();
            } else {
                return eq.hashMapLike(x);
            }
            break;
        }
    }
}

eq.extendToEQ = function(obj, opts) {
    obj.com$cognitect$transit$hashCode = opts["hashCode"];
    obj.com$cognitect$transit$equals = opts["equals"];
    return obj;
}

});

// com/cognitect/transit/types.js

goog.provide("com.cognitect.transit.types");

goog.scope(function() {

    var types = com.cognitect.transit.types,
        util  = com.cognitect.transit.util,
        eq    = com.cognitect.transit.eq,
        Long  = goog.math.Long;

    if(typeof Symbol != "undefined") {
        types.ITERATOR = Symbol.iterator;
    } else {
        types.ITERATOR = "@@iterator";
    }

    /**
     * @constructor
     */
    types.TaggedValue = function Transit$TaggedValue(tag, rep) {
        this.tag = tag;
        this.rep = rep;
        this.hashCode = -1;
    };

    types.TaggedValue.prototype.toString = function() {
        return "[TaggedValue: " + this.tag + ", " + this.rep + "]";
    };

    types.TaggedValue.prototype.equiv = function(other) {
        return eq.equals(this, other);
    };
    types.TaggedValue.prototype["equiv"] = types.TaggedValue.prototype.equiv;

    types.TaggedValue.prototype.com$cognitect$transit$equals = function(other) {
        if(other instanceof types.TaggedValue) {
            return (this.tag === other.tag) && eq.equals(this.rep, other.rep);
        } else {
            return false;
        }
    };

    types.TaggedValue.prototype.com$cognitect$transit$hashCode = function() {
        if(this.hashCode === -1) {
            this.hashCode = eq.hashCombine(eq.hashCode(this.tag), eq.hashCode(this.rep));
        }
        return this.hashCode;
    };

    types.taggedValue = function(tag, rep) {
        return new types.TaggedValue(tag, rep);
    };

    types.isTaggedValue = function(x) {
        return x instanceof types.TaggedValue;
    };

    types.nullValue = function() {
        return null;
    };

    types.boolValue = function(s) {
        return s === "t";
    };

    types.MAX_INT = Long.fromString("9007199254740991");
    types.MIN_INT = Long.fromString("-9007199254740991");

    types.intValue = function(s) {
        if(typeof s === "number") {
            return s;
        } else if(s instanceof Long) {
            return s;
        } else {
            var n = Long.fromString(s, 10);
            if(n.greaterThan(types.MAX_INT) ||
                n.lessThan(types.MIN_INT)) {
                return n;
            } else {
                return n.toNumber();
            }
        }
    };

    Long.prototype.equiv = function(other) {
        return eq.equals(this, other);
    };
    Long.prototype["equiv"] = Long.prototype.equiv;

    Long.prototype.com$cognitect$transit$equals = function(other) {
        return (other instanceof Long) && this.equals(other);
    };

    Long.prototype.com$cognitect$transit$hashCode = function() {
        return this.toInt();
    };

    types.isInteger = function(x) {
        if(x instanceof Long) {
            return true;
        } else {
            return (typeof x === "number") && !isNaN(x) && !(x === Infinity) && (parseFloat(x) === parseInt(x, 10));
        }
    };

    types.floatValue = function(s) {
        return parseFloat(s);
    };

    types.bigInteger = function(s) {
        return types.taggedValue("n", s);
    };

    types.isBigInteger = function(x) {
        return (x instanceof types.TaggedValue) && (x.tag === "n");
    };

    types.bigDecimalValue = function(s) {
        return types.taggedValue("f", s);
    };

    types.isBigDecimal = function(x) {
        return (x instanceof types.TaggedValue) && (x.tag === "f");
    };

    types.charValue = function(s) {
        return s;
    };

    /**
     * @constructor
     */
    types.Keyword = function Transit$Keyword(name) {
        this._name = name;
        this.hashCode = -1;
    };

    types.Keyword.prototype.toString = function() {
        return ":"+this._name;
    };

    types.Keyword.prototype["namespace"] = function() {
        var idx = this._name.indexOf("/");
        if(idx != -1) {
            return this._name.substring(0, idx);
        } else {
            return null;
        }
    };

    types.Keyword.prototype["name"] = function() {
        var idx = this._name.indexOf("/");
        if(idx != -1) {
            return this._name.substring(idx+1, this._name.length);
        } else {
            return this._name;
        }
    };

    types.Keyword.prototype.equiv = function(other) {
        return eq.equals(this, other);
    };
    types.Keyword.prototype["equiv"] = types.Keyword.prototype.equiv;

    types.Keyword.prototype.com$cognitect$transit$equals = function(other) {
        return (other instanceof types.Keyword) && this._name == other._name;
    };

    types.Keyword.prototype.com$cognitect$transit$hashCode = function() {
        if(this.hashCode === -1) {
            this.hashCode = eq.hashCode(this._name);
        }
        return this.hashCode;
    };

    types.keyword = function(s) {
        return new types.Keyword(s);
    };

    types.isKeyword = function(x) {
        return x instanceof types.Keyword;
    };

    /**
     * @constructor
     */
    types.Symbol = function Transit$Symbol(name) {
        this._name = name;
        this.hashCode = -1;
    };

    types.Symbol.prototype["namespace"] = function() {
        var idx = this._name.indexOf("/");
        if(idx != -1) {
            return this._name.substring(0, idx);
        } else {
            return null;
        }
    };

    types.Symbol.prototype["name"] = function() {
        var idx = this._name.indexOf("/");
        if(idx != -1) {
            return this._name.substring(idx+1, this._name.length);
        } else {
            return this._name;
        }
    };

    types.Symbol.prototype.toString = function() {
        return this._name;
    };

    types.Symbol.prototype.equiv = function(other) {
        return eq.equals(this, other);
    };
    types.Symbol.prototype["equiv"] = types.Symbol.prototype.equiv;

    types.Symbol.prototype.com$cognitect$transit$equals = function(other) {
        return (other instanceof types.Symbol) && this._name == other._name;
    };

    types.Symbol.prototype.com$cognitect$transit$hashCode = function() {
        if(this.hashCode === -1) {
            this.hashCode = eq.hashCode(this._name);
        }
        return this.hashCode;
    };

    types.symbol = function(s) {
        return new types.Symbol(s);
    };

    types.isSymbol = function(x) {
        return x instanceof types.Symbol;
    };

    types.hexFor = function(aLong, sidx, eidx) {
        var ret   = "";

        eidx  = eidx || (sidx+1);

        for(var i=sidx, shift=(7-i)*8, mask=Long.fromInt(0xff).shiftLeft(shift); i < eidx; i++, shift-=8, mask=mask.shiftRightUnsigned(8)) {
            var s = aLong.and(mask).shiftRightUnsigned(shift).toString(16);
            if(s.length == 1) {
                s = "0" + s;
            }
            ret += s;
        }

        return ret;
    };

    /**
     * @constructor
     */
    types.UUID = function Transit$UUID(high, low) {
        this.high = high;
        this.low = low;
        this.hashCode = -1;
    };

    types.UUID.prototype.getLeastSignificantBits = function() {
        return this.low;
    };

    types.UUID.prototype.getMostSignificantBits = function() {
        return this.high;
    };

    types.UUID.prototype.toString = function() {
        var s    = "",
            hi64 = this.high,
            lo64 = this.low;

        s += types.hexFor(hi64, 0, 4) + "-";
        s += types.hexFor(hi64, 4, 6) + "-";
        s += types.hexFor(hi64, 6, 8) + "-";
        s += types.hexFor(lo64, 0, 2) + "-";
        s += types.hexFor(lo64, 2, 8);

        return s;
    };

    types.UUID.prototype.equiv = function(other) {
        return eq.equals(this, other);
    };
    types.UUID.prototype["equiv"] = types.UUID.prototype.equiv;

    types.UUID.prototype.com$cognitect$transit$equals = function(other) {
        return (other instanceof types.UUID) && this.high.equals(other.high) && this.low.equals(other.low);
    };

    types.UUID.prototype.com$cognitect$transit$hashCode = function() {
        if(this.hashCode === -1) {
            // TODO: follow http://hg.openjdk.java.net/jdk6/jdk6/jdk/file/2d585507a41b/src/share/classes/java/util/UUID.java
            this.hashCode = eq.hashCode(this.toString());
        }
        return this.hashCode;
    };

    types.UUIDfromString = function uuidFromString(s) {
        s = s.replace(/-/g, "");

        var hi64 = null,
            lo64 = null,
            hi32 = 0,
            lo32 = 0,
            off  = 24,
            i    = 0;

        for(hi32=0, i=0, off= 24; i < 8; i+=2, off-=8) {
            hi32 |= (parseInt(s.substring(i,i+2),16) << off);
        }

        for(lo32=0, i=8, off=24; i < 16; i+=2, off-=8) {
            lo32 |= (parseInt(s.substring(i,i+2),16) << off);
        }

        hi64 = Long.fromBits(lo32, hi32);

        for(hi32=0, i=16, off=24; i < 24; i+=2, off-=8) {
            hi32 |= (parseInt(s.substring(i,i+2),16) << off);
        }

        for(lo32=0, i=24, off=24; i < 32; i+=2, off-=8) {
            lo32 |= (parseInt(s.substring(i,i+2),16) << off);
        }

        lo64 = Long.fromBits(lo32, hi32);

        return new types.UUID(hi64, lo64);
    };

    types.uuid = function(s) {
        return types.UUIDfromString(s);
    };

    types.isUUID = function(x) {
        return x instanceof types.UUID;
    };

    types.date = function(s) {
        s = typeof s === "number" ? s : parseInt(s, 10);
        return new Date(s);
    };

    types.verboseDate = function(s) {
        return new Date(s);
    };

    Date.prototype.com$cognitect$transit$equals = function(other) {
        if(other instanceof Date) {
            return this.valueOf() === other.valueOf();
        } else {
            return false;
        }
    };

    Date.prototype.com$cognitect$transit$hashCode = function() {
        return this.valueOf();
    };

    /**
     * @param {string} str
     * @param {*=} decoder
     * @returns {com.cognitect.transit.types.TaggedValue|Uint8Array}
     */
    types.binary = function(str, decoder) {
        if((!decoder || (decoder.preferBuffers !== false)) && (typeof goog.global.Buffer != "undefined")) {
            return new goog.global.Buffer(str, "base64");
        } else if(typeof Uint8Array != "undefined") {
            return util.Base64ToUint8(str);
        } else {
            return types.taggedValue("b", str);
        }
    };

    types.isBinary = function(x) {
        if((typeof goog.global.Buffer != "undefined") && (x instanceof goog.global.Buffer)) {
            return true;
        } else if((typeof Uint8Array != "undefined") && (x instanceof Uint8Array)) {
            return true;
        } else {
            return (x instanceof types.TaggedValue) && (x.tag === "b");
        }
    };

    types.uri = function(s) {
        return types.taggedValue("r", s);
    };

    types.isURI = function(x) {
        return (x instanceof types.TaggedValue) && (x.tag === "r");
    };

    /**
     * @const
     * @type {number}
     */
    types.KEYS = 0;

    /**
     * @const
     * @type {number}
     */
    types.VALUES = 1;

    /**
     * @const
     * @type {number}
     */
    types.ENTRIES = 2;

    /**
     * @constructor
     */
    types.TransitArrayMapIterator = function Transit$ArrayMapIterator(entries, type) {
        this.entries = entries;
        this.type = type || types.KEYS;
        this.idx = 0;
    };

    types.TransitArrayMapIterator.prototype.next = function() {
        if(this.idx < this.entries.length) {

            var value = null;

            if(this.type === types.KEYS) {
                value = this.entries[this.idx];
            } else if(this.type === types.VALUES) {
                value = this.entries[this.idx+1];
            } else {
                value = [this.entries[this.idx], this.entries[this.idx+1]];
            }

            var ret = {
                "value": value,
                "done": false
            };

            this.idx+=2;

            return ret;
        } else {
            return {"value": null, "done": true}
        }
    };
    types.TransitArrayMapIterator.prototype["next"] = types.TransitArrayMapIterator.prototype.next;

    types.TransitArrayMapIterator.prototype[types.ITERATOR] = function() {
        return this;
    };

    /**
     * @constructor
     */
    types.TransitMapIterator = function Transit$MapIterator(map, type) {
        this.map = map;
        this.type = type || types.KEYS;
        this.keys = this.map.getKeys();
        this.idx = 0;
        /** @type {?Object} */
        this.bucket = null;
        this.bucketIdx = 0;
    };

    types.TransitMapIterator.prototype.next = function() {
        if(this.idx < this.map.size) {
            if((this.bucket == null) || !(this.bucketIdx < this.bucket.length)) {
                this.bucket = this.map.map[this.keys[this.idx]];
                this.bucketIdx = 0;
            }

            var value = null;
            if(this.type === types.KEYS) {
                value = this.bucket[this.bucketIdx];
            } else if(this.type === types.VALUES) {
                value = this.bucket[this.bucketIdx+1];
            } else {
                value = [this.bucket[this.bucketIdx], this.bucket[this.bucketIdx+1]];
            }

            var ret = {
                "value": value,
                "done": false
            };

            this.idx++;
            this.bucketIdx+=2;

            return ret;
        } else {
            return {"value": null, "done": true};
        }
    };
    types.TransitMapIterator.prototype["next"] = types.TransitMapIterator.prototype.next;

    types.TransitMapIterator.prototype[types.ITERATOR] = function() {
        return this;
    };

    types.mapEquals = function(me, you) {
        if ((me instanceof types.TransitMap) && types.isMap(you)) {
            if(me.size !== you.size) return false;
            for (var code in me.map) {
                var bucket = me.map[code];
                for (var j = 0; j < bucket.length; j+=2) {
                    if (!eq.equals(bucket[j+1], you.get(bucket[j]))) {
                        return false;
                    }
                }
            }
            return true;
        } else if((me instanceof types.TransitArrayMap) && types.isMap(you)) {
            if(me.size !== you.size) return false;
            var entries = me._entries;
            for (var j = 0; j < entries.length; j+=2) {
                if (!eq.equals(entries[j+1], you.get(entries[j]))) {
                    return false;
                }
            }
            return true;
        } else if(you != null && (typeof you === "object")) {
            var ks    = util.objectKeys(you),
                kslen = ks.length;
            if(me.size === kslen) {
                for(var i = 0 ; i < kslen; i++) {
                    var k = ks[i];
                    if(!me.has(k) || !eq.equals(you[k], me.get(k))) {
                        return false;
                    }
                }
                return true;
            } else {
                return false;
            }
        } else {
            return false;
        }
    };

    /**
     * @const
     * @type {number}
     */
    types.SMALL_ARRAY_MAP_THRESHOLD = 8;

    /**
     * @const
     * @type {number}
     */
    types.ARRAY_MAP_THRESHOLD = 32;

    /**
     * @const
     * @type {number}
     */
    types.ARRAY_MAP_ACCESS_THRESHOLD = 32;

    types.print = function(x) {
        if(x == null) {
            return "null";
        } if(goog.typeOf(x) === "array") {
            return "[" + x.toString() + "]";
        } else if(goog.typeOf(x) === "string") {
            return "\"" + x + "\"";
        } else {
            return x.toString();
        }
    };

    types.printMap = function(map) {
        var idx = 0,
            str = "TransitMap {";
        map.forEach(function(v, k) {
            str += types.print(k) + " => " + types.print(v);
            if(idx < map.size-1) {
                str += ", ";
            }
            idx++;
        });
        return str + "}";
    };

    types.printSet = function(set) {
        var idx  = 0,
            str  = "TransitSet {";
        set.forEach(function(v) {
            str += types.print(v);
            if(idx < set.size-1) {
                str += ", ";
            }
            idx++;
        });
        return str + "}";
    };

    /**
     * @constructor
     * @param {Array} entries
     */
    types.TransitArrayMap = function Transit$ArrayMap(entries) {
        this._entries = entries;
        this.backingMap = null;
        this.hashCode = -1;
        this.size = entries.length / 2;
        this.accesses = 0;
    };

    types.TransitArrayMap.prototype.toString = function() {
        return types.printMap(this);
    };

    types.TransitArrayMap.prototype["inspect"] = function() {
        return this.toString();
    };

    types.TransitArrayMap.prototype.convert = function() {
        if(this.backingMap) {
            throw Error("Invalid operation, already converted");
        }
        if(this.size < types.SMALL_ARRAY_MAP_THRESHOLD) return false;
        this.accesses++;
        if(this.accesses > types.ARRAY_MAP_ACCESS_THRESHOLD) {
            this.backingMap = types.map(this._entries, false, true);
            this._entries = [];
            return true;
        } else {
            return false;
        }
    };

    types.TransitArrayMap.prototype.clear = function() {
        this.hashCode = -1;
        if(this.backingMap) {
            this.backingMap.clear();
            this.size = 0;
        } else {
            this._entries = [];
            this.size = 0;
        }
    };
    types.TransitArrayMap.prototype["clear"] = types.TransitArrayMap.prototype.clear;

    types.TransitArrayMap.prototype.keys = function() {
        if(this.backingMap) {
            return this.backingMap.keys();
        } else {
            return new types.TransitArrayMapIterator(this._entries, types.KEYS);
        }
    };
    types.TransitArrayMap.prototype["keys"] = types.TransitArrayMap.prototype.keys;

    types.TransitArrayMap.prototype.keySet = function() {
        if(this.backingMap) {
            return this.backingMap.keySet();
        } else {
            var ret = [];
            for(var i = 0, j = 0; j < this._entries.length; i++, j+=2) {
                ret[i] = this._entries[j];
            }
            return ret;
        }
    };
    types.TransitArrayMap.prototype["keySet"] = types.TransitArrayMap.prototype.keySet;

    types.TransitArrayMap.prototype.entries = function() {
        if(this.backingMap) {
            return this.backingMap.entries();
        } else {
            return new types.TransitArrayMapIterator(this._entries, types.ENTRIES);
        }
    };
    types.TransitArrayMap.prototype["entries"] = types.TransitArrayMap.prototype.entries;

    types.TransitArrayMap.prototype.values = function() {
        if(this.backingMap) {
            return this.backingMap.values();
        } else {
            return new types.TransitArrayMapIterator(this._entries, types.VALUES);
        }
    };
    types.TransitArrayMap.prototype["values"] = types.TransitArrayMap.prototype.values;

    /**
     * @param {function(*,*)} f
     */
    types.TransitArrayMap.prototype.forEach = function(f) {
        if(this.backingMap) {
            this.backingMap.forEach(f);
        } else {
            for(var i = 0; i < this._entries.length; i+=2) {
                f(this._entries[i+1], this._entries[i]);
            }
        }
    };
    types.TransitArrayMap.prototype["forEach"] = types.TransitArrayMap.prototype.forEach;

    /**
     * @param {*} k
     * @param {*=} notFound
     * @returns {*}
     */
    types.TransitArrayMap.prototype.get = function(k, notFound) {
        if(this.backingMap) {
            return this.backingMap.get(k);
        } else {
            if(this.convert()) {
                return this.get(k);
            } else {
                for(var i = 0; i < this._entries.length; i+=2) {
                    if(eq.equals(this._entries[i], k)) {
                        return this._entries[i+1];
                    }
                }
                return notFound;
            }
        }
    };
    types.TransitArrayMap.prototype["get"] = types.TransitArrayMap.prototype.get;

    types.TransitArrayMap.prototype.has = function(k) {
        if(this.backingMap) {
            return this.backingMap.has(k);
        } else {
            if(this.convert()) {
                return this.has(k);
            } else {
                for(var i = 0; i < this._entries.length; i+=2) {
                    if(eq.equals(this._entries[i], k)) {
                        return true;
                    }
                }
                return false;
            }
        }
    };
    types.TransitArrayMap.prototype["has"] = types.TransitArrayMap.prototype.has;

    types.TransitArrayMap.prototype.set = function(k, v) {
        this.hashCode = -1;
        if(this.backingMap) {
            this.backingMap.set(k, v);
            this.size = this.backingMap.size;
        } else {
            for(var i = 0; i < this._entries.length; i+=2) {
                if(eq.equals(this._entries[i], k)) {
                    this._entries[i+1] = v;
                    return;
                }
            }

            this._entries.push(k);
            this._entries.push(v);
            this.size++;

            if(this.size > types.ARRAY_MAP_THRESHOLD) {
                this.backingMap = types.map(this._entries, false, true);
                this._entries = null;
            }
        }
    };
    types.TransitArrayMap.prototype["set"] = types.TransitArrayMap.prototype.set;

    types.TransitArrayMap.prototype["delete"] = function(k) {
        this.hashCode = -1;
        if(this.backingMap) {
            var ret = this.backingMap.delete(k);
            this.size = this.backingMap.size;
            return ret;
        } else {
            for(var i = 0; i < this._entries.length; i+=2) {
                if(eq.equals(this._entries[i], k)) {
                    var ret = this._entries[i+1];
                    this._entries.splice(i, 2);
                    this.size--;
                    return ret;
                }
            }
        }
    };

    types.TransitArrayMap.prototype.clone = function() {
        var clone = types.map();

        this.forEach(function(v, k) {
            clone.set(k, v);
        });

        return clone;
    };
    types.TransitArrayMap.prototype["clone"] = types.TransitArrayMap.prototype.clone;

    types.TransitArrayMap.prototype[types.ITERATOR] = function() {
        return this.entries();
    };

    types.TransitArrayMap.prototype.com$cognitect$transit$hashCode = function() {
        if(this.backingMap) {
            return this.backingMap.com$cognitect$transit$hashCode();
        } else {
            if(this.hashCode === -1) {
                this.hashCode = eq.hashMapLike(this);
            }
            return this.hashCode;
        }
    };

    types.TransitArrayMap.prototype.com$cognitect$transit$equals = function(other) {
        if(this.backingMap) {
            return types.mapEquals(this.backingMap, other);
        } else {
            return types.mapEquals(this, other);
        }
    };

    /**
     * TransitMap
     *   A hash map. Support arbitrarily complex keys. Lookup is based on the value of the
     *   the key not identity. Otherwise the API follows the ES6 map interface:
     *   http://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
     * @constructor
     * @param {null|Array=} keys
     * @param {null|Object=} map
     * @param {null|number=} size
     */
    types.TransitMap = function Transit$Map(keys, map, size) {
        this.map = map || {};
        this._keys = keys || [];
        this.size = size || 0;
        this.hashCode = -1;
    };

    types.TransitMap.prototype.toString = function() {
        return types.printMap(this);
    };

    types.TransitMap.prototype["inspect"] = function() {
        return this.toString();
    };

    types.TransitMap.prototype.clear = function() {
        this.hashCode = -1;
        this.map = {};
        this._keys = [];
        this.size = 0;
    };
    types.TransitMap.prototype["clear"] = types.TransitMap.prototype.clear;

    types.TransitMap.prototype.getKeys = function() {
        if(this._keys != null) {
            return this._keys;
        } else {
            return util.objectKeys(this.map);
        }
    };

    types.TransitMap.prototype["delete"] = function(k) {
        this.hashCode = -1;
        this._keys = null;
        var code   = eq.hashCode(k),
            bucket = this.map[code];

        for(var i = 0; i < bucket.length; i+=2) {
            if(eq.equals(k, bucket[i])) {
                var ret = bucket[i+1];
                bucket.splice(i,2);
                if(bucket.length === 0) {
                    delete this.map[code];
                }
                this.size--;
                return ret;
            }
        }
    };

    types.TransitMap.prototype.entries = function() {
        return new types.TransitMapIterator(this, types.ENTRIES);
    };
    types.TransitMap.prototype["entries"] = types.TransitMap.prototype.entries;

    types.TransitMap.prototype.forEach = function(callback) {
        var ks = this.getKeys();
        for(var i = 0; i < ks.length; i++) {
            var bucket = this.map[ks[i]];
            for(var j = 0; j < bucket.length; j+=2) {
                callback(bucket[j+1], bucket[j], this);
            }
        }
    };
    types.TransitMap.prototype["forEach"] = types.TransitMap.prototype.forEach;

    types.TransitMap.prototype.get = function(k, notFound) {
        var code   = eq.hashCode(k),
            bucket = this.map[code];
        if(bucket != null) {
            for(var i = 0; i < bucket.length; i+=2) {
                if(eq.equals(k,bucket[i])) {
                    return bucket[i+1];
                }
            }
        } else {
            return notFound;
        }
    };
    types.TransitMap.prototype["get"] = types.TransitMap.prototype.get;

    types.TransitMap.prototype.has = function(k) {
        var code   = eq.hashCode(k),
            bucket = this.map[code];
        if(bucket != null) {
            for(var i = 0; i < bucket.length; i+=2) {
                if(eq.equals(k, bucket[i])) {
                    return true;
                }
            }
            return false;
        } else {
            return false;
        }
    };
    types.TransitMap.prototype["has"] = types.TransitMap.prototype.has;

    types.TransitMap.prototype.keys = function() {
        return new types.TransitMapIterator(this, types.KEYS);
    };
    types.TransitMap.prototype["keys"] = types.TransitMap.prototype.keys;

    types.TransitMap.prototype.keySet = function() {
        var keys = this.getKeys(),
            ret  = [];

        for(var i = 0; i < keys.length; i++) {
            var bucket = this.map[keys[i]];
            for(var j = 0; j < bucket.length; j+=2) {
                ret.push(bucket[j]);
            }
        }

        return ret;
    };
    types.TransitMap.prototype["keySet"] = types.TransitMap.prototype.keySet;

    types.TransitMap.prototype.set = function(k, v) {
        this.hashCode = -1;
        var code = eq.hashCode(k),
            bucket = this.map[code];
        if(bucket == null) {
            if(this._keys) {
                this._keys.push(code);
            }
            this.map[code] = [k, v];
            this.size++;
        } else {
            var newEntry = true;
            for(var i = 0; i < bucket.length; i+=2) {
                if(eq.equals(v, bucket[i])) {
                    newEntry = false;
                    bucket[i] = v;
                    break;
                }
            }
            if(newEntry) {
                bucket.push(k);
                bucket.push(v);
                this.size++;
            }
        }
    };
    types.TransitMap.prototype["set"] = types.TransitMap.prototype.set;

    types.TransitMap.prototype.values = function() {
        return new types.TransitMapIterator(this, types.VALUES);
    };
    types.TransitMap.prototype["values"] = types.TransitMap.prototype.values;

    types.TransitMap.prototype.clone = function() {
        var clone = types.map();

        this.forEach(function(v, k) {
           clone.set(k, v);
        });

        return clone;
    };
    types.TransitMap.prototype["clone"] = types.TransitMap.prototype.clone;

    types.TransitMap.prototype[types.ITERATOR] = function() {
        return this.entries();
    };

    types.TransitMap.prototype.com$cognitect$transit$hashCode = function() {
        if(this.hashCode === -1) {
            this.hashCode = eq.hashMapLike(this);
        }
        return this.hashCode;
    };

    types.TransitMap.prototype.com$cognitect$transit$equals = function(other) {
        return types.mapEquals(this, other);
    };

    /**
     * @param {Array=} arr
     * @param {boolean=} checkDups
     * @param {boolean=} hashMap
     * @returns {com.cognitect.transit.MapLike}
     */
    types.map = function(arr, checkDups, hashMap) {
        arr = arr || [];
        checkDups = (checkDups === false) ? checkDups : true;
        hashMap = (hashMap === true) ? hashMap : false;

        if(!hashMap && (arr.length <= (types.ARRAY_MAP_THRESHOLD*2))) {
            if(checkDups) {
                var t = arr;
                arr = [];
                for(var i = 0; i < t.length; i+=2) {
                    var seen = false;
                    for(var j = 0; j < arr.length; j+=2) {
                        if(eq.equals(arr[j], t[i])) {
                            arr[j+1] = t[i+1];
                            seen = true;
                            break;
                        }
                    }
                    if(!seen) {
                        arr.push(t[i]);
                        arr.push(t[i+1]);
                    }
                }
            }
            return new types.TransitArrayMap(arr);
        } else {
            var map  = {},
                keys = [],
                size = 0;
            for(var i = 0; i < arr.length; i+=2) {
                var code = eq.hashCode(arr[i]),
                    bucket = map[code];
                if(bucket == null) {
                    keys.push(code);
                    map[code] = [arr[i], arr[i+1]];
                    size++;
                } else {
                    var newEntry = true;
                    for(var j = 0; j < bucket.length; j+= 2) {
                        if(eq.equals(bucket[j], arr[i])) {
                            bucket[j+1] = arr[i+1];
                            newEntry = false;
                            break;
                        }
                    }
                    if(newEntry) {
                        bucket.push(arr[i]);
                        bucket.push(arr[i+1]);
                        size++;
                    }
                }
            }
            return new types.TransitMap(keys, map, size);
        }
    };

    types.isArrayMap = function(x) {
        return (x instanceof types.TransitArrayMap);
    };

    types.isMap = function(x) {
        return ((x instanceof types.TransitArrayMap) ||
                (x instanceof types.TransitMap));
    };

    /**
     * @constructor
     * @param {com.cognitect.transit.MapLike} map
     */
    types.TransitSet = function Transit$Set(map) {
        this.map = map;
        this.size = map.size;
    };

    types.TransitSet.prototype.toString = function() {
        return types.printSet(this);
    };

    types.TransitSet.prototype["inspect"] = function() {
        return this.toString();
    };

    types.TransitSet.prototype.add = function(value) {
        this.map.set(value, value);
        this.size = this.map.size;
    };
    types.TransitSet.prototype["add"] = types.TransitSet.prototype.add;

    types.TransitSet.prototype.clear = function() {
        this.map = new types.TransitMap();
        this.size = 0;
    };
    types.TransitSet.prototype["clear"] = types.TransitSet.prototype.clear;

    types.TransitSet.prototype["delete"] = function(value) {
        var ret = this.map.delete(value);
        this.size = this.map.size;
        return ret;
    };

    types.TransitSet.prototype.entries = function() {
        return this.map.entries();
    };
    types.TransitSet.prototype["entries"] = types.TransitSet.prototype.entries;

    /**
     * @param {function(*,*)} iterator
     * @param {Object=} thisArg
     */
    types.TransitSet.prototype.forEach = function(iterator, thisArg) {
        var self = this;
        this.map.forEach(function(v, k, m) {
            iterator(k, self);
        });
    };
    types.TransitSet.prototype["forEach"] = types.TransitSet.prototype.forEach;

    types.TransitSet.prototype.has = function(value) {
        return this.map.has(value);
    };
    types.TransitSet.prototype["has"] = types.TransitSet.prototype.has;

    types.TransitSet.prototype.keys = function() {
        return this.map.keys();
    };
    types.TransitSet.prototype["keys"] = types.TransitSet.prototype.keys;

    types.TransitSet.prototype.keySet = function() {
        return this.map.keySet();
    };
    types.TransitSet.prototype["keySet"] = types.TransitSet.prototype.keySet;

    types.TransitSet.prototype.values = function() {
        return this.map.values();
    };
    types.TransitSet.prototype["values"] = types.TransitSet.prototype.values;

    types.TransitSet.prototype.clone = function() {
        var clone = types.set();

        this.forEach(function(k) {
            clone.add(k);
        });

        return clone;
    };
    types.TransitSet.prototype["clone"] = types.TransitSet.prototype.clone;

    types.TransitSet.prototype[types.ITERATOR] = function() {
        return this.values();
    };

    types.TransitSet.prototype.com$cognitect$transit$equals = function(other) {
        if(other instanceof types.TransitSet) {
            if(this.size === other.size) {
                return eq.equals(this.map, other.map);
            }
        } else {
            return false;
        }
    };

    types.TransitSet.prototype.com$cognitect$transit$hashCode = function(other) {
        return eq.hashCode(this.map);
    };

    /**
     * @param {Array=} arr
     * @returns {com.cognitect.transit.SetLike}
     */
    types.set = function(arr) {
        arr = arr || [];

        var map  = {},
            keys = [],
            size = 0;

        for(var i = 0; i < arr.length; i++) {
            var code = eq.hashCode(arr[i]),
                vals = map[code];
            if(vals == null) {
                keys.push(code);
                map[code] = [arr[i], arr[i]];
                size++
            } else {
                var newEntry = true;
                for(var j = 0; j < vals.length; j+= 2) {
                    if(eq.equals(vals[j], arr[i])) {
                        newEntry = false;
                        break;
                    }
                }
                if(newEntry) {
                    vals.push(arr[i]);
                    vals.push(arr[i]);
                    size++;
                }
            }
        }

        return new types.TransitSet(new types.TransitMap(keys, map, size));
    };

    types.isSet = function(x) {
        return x instanceof types.TransitSet;
    };

    types.quoted = function(obj) {
        return types.taggedValue("'", obj);
    };

    types.isQuoted = function(x) {
        return (x instanceof types.TaggedValue) && (x.tag === "'");
    };

    types.list = function(xs) {
        return types.taggedValue("list", xs);
    };

    types.isList = function(x) {
        return (x instanceof types.TaggedValue) && (x.tag === "list");
    };

    types.link = function(rep) {
        return types.taggedValue("link", rep);
    };

    types.isLink = function(x) {
        return (x instanceof types.TaggedValue) && (x.tag === "link")
    };

    types.specialDouble = function(v) {
        switch(v) {
            case "-INF":
                return -Infinity;
            case "INF":
                return Infinity;
            case "NaN":
                return NaN;
            default:
                throw new Error("Invalid special double value " + v);
                break;
        }
    };

});

// com/cognitect/transit/handlers.js

goog.provide("com.cognitect.transit.handlers");

goog.scope(function () {

    var handlers = com.cognitect.transit.handlers,
        util     = com.cognitect.transit.util,
        types    = com.cognitect.transit.types,
        Long     = goog.math.Long;

    handlers.ctorGuid = 0;

    /**
     * @const
     * @type {string}
     */
    handlers.ctorGuidProperty = "transit$guid$" + util.randomUUID();

    handlers.typeTag = function (ctor) {
        if (ctor == null) {
            return "null";
        } else if (ctor === String) {
            return "string";
        } else if (ctor === Boolean) {
            return "boolean";
        } else if (ctor === Number) {
            return "number";
        } else if (ctor === Array) {
            return "array";
        } else if (ctor === Object) {
            return "map";
        } else {
            var tag = ctor[handlers.ctorGuidProperty];
            if (tag == null) {
                if (typeof Object.defineProperty != "undefined") {
                    tag = ++handlers.ctorGuid;
                    Object.defineProperty(ctor, handlers.ctorGuidProperty, {
                        value: tag,
                        enumerable: false
                    });
                } else {
                    ctor[handlers.ctorGuidProperty] = tag = ++handlers.ctorGuid;
                }
            }
            return tag;
        }
    };

    handlers.constructor = function (x) {
        if (x == null) {
            return null;
        } else {
            return x.constructor;
        }
    };

    handlers.padZeros = function (n, m) {
        var s = n.toString();
        for (var i = s.length; i < m; i++) {
            s = "0" + s;
        }
        return s;
    };

    handlers.stringableKeys = function (m) {
        var stringable = false,
            ks = util.objectKeys(m);

        for (var i = 0; i < ks.length; i++) {
        }

        return true;
    };

    /**
     * @constructor
     */
    handlers.NilHandler = function Transit$NilHandler() {
    };
    handlers.NilHandler.prototype.tag = function (v) {
        return "_";
    };
    handlers.NilHandler.prototype.rep = function (v) {
        return null;
    };
    handlers.NilHandler.prototype.stringRep = function (v) {
        return "null";
    };

    /**
     * @constructor
     */
    handlers.StringHandler = function Transit$StringHandler() {
    };
    handlers.StringHandler.prototype.tag = function (v) {
        return "s";
    };
    handlers.StringHandler.prototype.rep = function (v) {
        return v;
    };
    handlers.StringHandler.prototype.stringRep = function (v) {
        return v;
    };

    /**
     * @constructor
     */
    handlers.NumberHandler = function Transit$NumberHandler() {
    };
    handlers.NumberHandler.prototype.tag = function (v) {
        return "i";
    };
    handlers.NumberHandler.prototype.rep = function (v) {
        return v;
    };
    handlers.NumberHandler.prototype.stringRep = function (v) {
        return v.toString();
    };

    /**
     * @constructor
     */
    handlers.IntegerHandler = function Transit$IntegerHandler() {
    };
    handlers.IntegerHandler.prototype.tag = function (v) {
        return "i";
    };
    handlers.IntegerHandler.prototype.rep = function (v) {
        return v.toString();
    };
    handlers.IntegerHandler.prototype.stringRep = function (v) {
        return v.toString();
    };

    /**
     * @constructor
     */
    handlers.BooleanHandler = function Transit$BooleanHandler() {
    };
    handlers.BooleanHandler.prototype.tag = function (v) {
        return "?";
    };
    handlers.BooleanHandler.prototype.rep = function (v) {
        return v;
    };
    handlers.BooleanHandler.prototype.stringRep = function (v) {
        return v.toString();
    };

    /**
     * @constructor
     */
    handlers.ArrayHandler = function Transit$ArrayHandler() {
    };
    handlers.ArrayHandler.prototype.tag = function (v) {
        return "array";
    };
    handlers.ArrayHandler.prototype.rep = function (v) {
        return v;
    };
    handlers.ArrayHandler.prototype.stringRep = function (v) {
        return null;
    };

    /**
     * @constructor
     */
    handlers.MapHandler = function Transit$MapHandler() {
    };
    handlers.MapHandler.prototype.tag = function (v) {
        return "map";
    };
    handlers.MapHandler.prototype.rep = function (v) {
        return v;
    };
    handlers.MapHandler.prototype.stringRep = function (v) {
        return null;
    };

    /**
     * @constructor
     */
    handlers.VerboseDateHandler = function Transit$VerboseDateHandler() {
    };
    handlers.VerboseDateHandler.prototype.tag = function (v) {
        return "t";
    };
    handlers.VerboseDateHandler.prototype.rep = function (v) {
        return v.getUTCFullYear() + "-" + handlers.padZeros(v.getUTCMonth() + 1, 2) + "-" +
            handlers.padZeros(v.getUTCDate(), 2) + "T" + handlers.padZeros(v.getUTCHours(), 2) + ":" +
            handlers.padZeros(v.getUTCMinutes(), 2) + ":" + handlers.padZeros(v.getUTCSeconds(), 2) + "." +
            handlers.padZeros(v.getUTCMilliseconds(), 3) + "Z";
    };
    handlers.VerboseDateHandler.prototype.stringRep = function (v, h) {
        return h.rep(v);
    };

    /**
     * @constructor
     */
    handlers.DateHandler = function Transit$DateHandler() {
    };
    handlers.DateHandler.prototype.tag = function (v) {
        return "m";
    };
    handlers.DateHandler.prototype.rep = function (v) {
        return v.valueOf();
    };
    handlers.DateHandler.prototype.stringRep = function (v) {
        return v.valueOf().toString();
    };
    handlers.DateHandler.prototype.getVerboseHandler = function (v) {
        return new handlers.VerboseDateHandler();
    };

    /**
     * @constructor
     */
    handlers.UUIDHandler = function Transit$UUIDHandler() {
    };
    handlers.UUIDHandler.prototype.tag = function (v) {
        return "u";
    };
    handlers.UUIDHandler.prototype.rep = function (v) {
        return v.toString();
    };
    handlers.UUIDHandler.prototype.stringRep = function (v) {
        return v.toString();
    };

    /**
     * @constructor
     */
    handlers.KeywordHandler = function Transit$KeywordHandler() {
    };
    handlers.KeywordHandler.prototype.tag = function (v) {
        return ":";
    };
    handlers.KeywordHandler.prototype.rep = function (v) {
        return v._name;
    }; // NOTE: should be fqn
    handlers.KeywordHandler.prototype.stringRep = function (v, h) {
        return h.rep(v);
    };

    /**
     * @constructor
     */
    handlers.SymbolHandler = function Transit$SymbolHandler() {
    };
    handlers.SymbolHandler.prototype.tag = function (v) {
        return "$";
    };
    handlers.SymbolHandler.prototype.rep = function (v) {
        return v._name;
    }; // NOTE: should be str
    handlers.SymbolHandler.prototype.stringRep = function (v, h) {
        return h.rep(v);
    };

    /**
     * @constructor
     */
    handlers.TaggedHandler = function Transit$TaggedHandler() {
    };
    handlers.TaggedHandler.prototype.tag = function (v) {
        return v.tag;
    };
    handlers.TaggedHandler.prototype.rep = function (v) {
        return v.rep;
    };
    handlers.TaggedHandler.prototype.stringRep = function (v, h) {
        return null;
    };

    /**
     * @constructor
     */
    handlers.TransitSetHandler = function Transit$TransitSetHandler() {
    };
    handlers.TransitSetHandler.prototype.tag = function (v) {
        return "set";
    };
    handlers.TransitSetHandler.prototype.rep = function (v) {
        var arr = [];
        v.forEach(function (key, set) {
            arr.push(key);
        });
        return types.taggedValue("array", arr);
    };
    handlers.TransitSetHandler.prototype.stringRep = function (v, h) {
        return null;
    };

    /**
     * @constructor
     */
    handlers.TransitArrayMapHandler = function Transit$ArrayMapHandler() {
    };
    handlers.TransitArrayMapHandler.prototype.tag = function (v) {
        return "map";
    };
    handlers.TransitArrayMapHandler.prototype.rep = function (v) {
        return v;
    };
    handlers.TransitArrayMapHandler.prototype.stringRep = function (v, h) {
        return null;
    };

    /**
     * @constructor
     */
    handlers.TransitMapHandler = function Transit$MapHandler() {
    };
    handlers.TransitMapHandler.prototype.tag = function (v) {
        return "map";
    };
    handlers.TransitMapHandler.prototype.rep = function (v) {
        return v;
    };
    handlers.TransitMapHandler.prototype.stringRep = function (v, h) {
        return null;
    };

    /**
     * @constructor
     */
    handlers.BufferHandler = function Transit$BufferHandler() {
    };
    handlers.BufferHandler.prototype.tag = function (v) {
        return "b";
    };
    handlers.BufferHandler.prototype.rep = function (v) {
        return v.toString("base64");
    };
    handlers.BufferHandler.prototype.stringRep = function (v, h) {
        return null;
    };

    /**
     * @constructor
     */
    handlers.Uint8ArrayHandler = function Transit$Uint8ArrayHandler() {
    };
    handlers.Uint8ArrayHandler.prototype.tag = function (v) {
        return "b";
    };
    handlers.Uint8ArrayHandler.prototype.rep = function (v) {
        return util.Uint8ToBase64(v);
    };
    handlers.Uint8ArrayHandler.prototype.stringRep = function (v, h) {
        return null;
    };

    handlers.defaultHandlers = function (hs) {
        hs.set(null, new handlers.NilHandler());
        hs.set(String, new handlers.StringHandler());
        hs.set(Number, new handlers.NumberHandler());
        hs.set(Long, new handlers.IntegerHandler());
        hs.set(Boolean, new handlers.BooleanHandler());
        hs.set(Array, new handlers.ArrayHandler());
        hs.set(Object, new handlers.MapHandler());
        hs.set(Date, new handlers.DateHandler());
        hs.set(types.UUID, new handlers.UUIDHandler());
        hs.set(types.Keyword, new handlers.KeywordHandler());
        hs.set(types.Symbol, new handlers.SymbolHandler());
        hs.set(types.TaggedValue, new handlers.TaggedHandler());
        hs.set(types.TransitSet, new handlers.TransitSetHandler());
        hs.set(types.TransitArrayMap, new handlers.TransitArrayMapHandler());
        hs.set(types.TransitMap, new handlers.TransitMapHandler());

        if (typeof goog.global.Buffer != "undefined") {
            hs.set(goog.global.Buffer, new handlers.BufferHandler());
        }

        if (typeof Uint8Array != "undefined") {
            hs.set(Uint8Array, new handlers.Uint8ArrayHandler());
        }

        return hs;
    };

    /**
     * @constructor
     */
    handlers.Handlers = function Transit$Handlers() {
        this.handlers = {};
        handlers.defaultHandlers(this);
    };

    handlers.Handlers.prototype.get = function (ctor) {
        var h = null;
        if (typeof ctor === "string") {
            h = this.handlers[ctor];
        } else {
            h = this.handlers[handlers.typeTag(ctor)];
        }
        if (h != null) {
            return h;
        } else {
            return this.handlers["default"];
        }
    };
    handlers.Handlers.prototype["get"] = handlers.Handlers.prototype.get;

    handlers.validTag = function (tag) {
        switch (tag) {
            case "null":
            case "string":
            case "boolean":
            case "number":
            case "array":
            case "map":
                return false;
                break;
        }
        return true;
    };

    handlers.Handlers.prototype.set = function (ctor, handler) {
        if (typeof ctor === "string" && handlers.validTag(ctor)) {
            this.handlers[ctor] = handler;
        } else {
            this.handlers[handlers.typeTag(ctor)] = handler;
        }
    };

});    

// com/cognitect/transit/impl/decoder.js

goog.provide("com.cognitect.transit.impl.decoder");

goog.scope(function () {

    var decoder = com.cognitect.transit.impl.decoder,
        util    = com.cognitect.transit.util,
        d       = com.cognitect.transit.delimiters,
        caching = com.cognitect.transit.caching,
        types   = com.cognitect.transit.types;

    // =========================================================================
    // Decoder

    /**
     * @constructor
     */
    decoder.Tag = function Transit$Tag(s) {
        this.str = s;
    };

    decoder.tag = function (s) {
        return new decoder.Tag(s);
    };

    decoder.isTag = function (x) {
        return x && (x instanceof decoder.Tag);
    };

    decoder.isGroundHandler = function (handler) {
        switch (handler) {
            case "_":
            case "s":
            case "?":
            case "i":
            case "d":
            case "b":
            case "'":
            case "array":
            case "map":
                return true;
        }
        return false;
    };

    /**
     * A transit decoder
     * @constructor
     */
    decoder.Decoder = function Transit$Decoder(options) {
        this.options = options || {};
        this.handlers = {};
        for (var h in this.defaults.handlers) {
            this.handlers[h] = this.defaults.handlers[h];
        }
        for (var h in this.options["handlers"]) {
            if (decoder.isGroundHandler(h)) {
                throw new Error("Cannot override handler for ground type \"" + h + "\"");
            }
            this.handlers[h] = this.options["handlers"][h];
        }
        this.preferStrings = this.options["preferStrings"] != null ? this.options["preferStrings"] : this.defaults.preferStrings;
        this.preferBuffers = this.options["preferBuffers"] != null ? this.options["preferBuffers"] : this.defaults.preferBuffers;
        this.defaultHandler = this.options["defaultHandler"] || this.defaults.defaultHandler;
        /* NOT PUBLIC */
        this.mapBuilder = this.options["mapBuilder"];
        this.arrayBuilder = this.options["arrayBuilder"];
    };


    decoder.Decoder.prototype.defaults = {
        handlers: {
            "_": function (v, d) {
                return types.nullValue();
            },
            "?": function (v, d) {
                return types.boolValue(v);
            },
            "b": function (v, d) {
                return types.binary(v, d);
            },
            "i": function (v, d) {
                return types.intValue(v);
            },
            "n": function (v, d) {
                return types.bigInteger(v);
            },
            "d": function (v, d) {
                return types.floatValue(v);
            },
            "f": function (v, d) {
                return types.bigDecimalValue(v);
            },
            "c": function (v, d) {
                return types.charValue(v);
            },
            ":": function (v, d) {
                return types.keyword(v);
            },
            "$": function (v, d) {
                return types.symbol(v);
            },
            "r": function (v, d) {
                return types.uri(v);
            },
            "z": function (v, d) {
                return types.specialDouble(v);
            },

            // tagged
            "'": function (v, d) {
                return v;
            },
            "m": function (v, d) {
                return types.date(v);
            },
            "t": function (v, d) {
                return types.verboseDate(v);
            },
            "u": function (v, d) {
                return types.uuid(v);
            },
            "set": function (v, d) {
                return types.set(v);
            },
            "list": function (v, d) {
                return types.list(v);
            },
            "link": function (v, d) {
                return types.link(v);
            },
            "cmap": function (v, d) {
                return types.map(v, false);
            }
        },
        defaultHandler: function (c, val) {
            return types.taggedValue(c, val);
        },
        preferStrings: true,
        preferBuffers: true
    };

    /**
     * @param {*} node
     * @param {*} cache
     * @param {boolean=} asMapKey
     * @param {boolean=} tagValue
     * @returns {*}
     */
    decoder.Decoder.prototype.decode = function (node, cache, asMapKey, tagValue) {
        if (node == null) return null;

        var t = typeof node;

        switch (t) {
            case "string":
                return this.decodeString(node, cache, asMapKey, tagValue);
                break;
            case "object":
                if (util.isArray(node)) {
                    if (node[0] === "^ ") {
                        return this.decodeArrayHash(node, cache, asMapKey, tagValue);
                    } else {
                        return this.decodeArray(node, cache, asMapKey, tagValue);
                    }
                } else {
                    return this.decodeHash(node, cache, asMapKey, tagValue);
                }
                break;
        }

        return node;
    };
    decoder.Decoder.prototype["decode"] = decoder.Decoder.prototype.decode;

    decoder.Decoder.prototype.decodeString = function (string, cache, asMapKey, tagValue) {
        if (caching.isCacheable(string, asMapKey)) {
            var val = this.parseString(string, cache, false);
            if (cache) {
                cache.write(val, asMapKey);
            }
            return val;
        } else if (caching.isCacheCode(string)) {
            return cache.read(string, asMapKey);
        } else {
            return this.parseString(string, cache, asMapKey);
        }
    };

    decoder.Decoder.prototype.decodeHash = function (hash, cache, asMapKey, tagValue) {
        var ks = util.objectKeys(hash),
            key = ks[0],
            tag = ks.length == 1 ? this.decode(key, cache, false, false) : null;

        if (decoder.isTag(tag)) {
            var val = hash[key],
                handler = this.handlers[tag.str];
            if (handler != null) {
                return handler(this.decode(val, cache, false, true), this);
            } else {
                return types.taggedValue(tag.str, this.decode(val, cache, false, false));
            }
        } else if (this.mapBuilder) {
            if ((ks.length < (types.SMALL_ARRAY_MAP_THRESHOLD * 2)) && this.mapBuilder.fromArray) {
                var nodep = [];
                for (var i = 0; i < ks.length; i++) {
                    var strKey = ks[i];
                    nodep.push(this.decode(strKey, cache, true, false));
                    nodep.push(this.decode(hash[strKey], cache, false, false));
                }
                return this.mapBuilder.fromArray(nodep, hash);
            } else {
                var ret = this.mapBuilder.init(hash);
                for (var i = 0; i < ks.length; i++) {
                    var strKey = ks[i];
                    ret = this.mapBuilder.add(ret,
                        this.decode(strKey, cache, true, false),
                        this.decode(hash[strKey], cache, false, false),
                        hash);
                }
                return this.mapBuilder.finalize(ret, hash);
            }
        } else {
            var nodep = [];

            for (var i = 0; i < ks.length; i++) {
                var strKey = ks[i];
                nodep.push(this.decode(strKey, cache, true, false));
                nodep.push(this.decode(hash[strKey], cache, false, false));
            }

            return types.map(nodep, false);
        }
    };

    decoder.Decoder.prototype.decodeArrayHash = function (node, cache, asMapKey, tagValue) {
        if (this.mapBuilder) {
            if ((node.length < ((types.SMALL_ARRAY_MAP_THRESHOLD * 2) + 1)) && this.mapBuilder.fromArray) {
                var nodep = [];
                for (var i = 1; i < node.length; i += 2) {
                    nodep.push(this.decode(node[i], cache, true, false));
                    nodep.push(this.decode(node[i + 1], cache, false, false));
                }
                return this.mapBuilder.fromArray(nodep, node);
            } else {
                var ret = this.mapBuilder.init(node);
                for (var i = 1; i < node.length; i += 2) {
                    ret = this.mapBuilder.add(ret,
                        this.decode(node[i], cache, true, false),
                        this.decode(node[i + 1], cache, false, false),
                        node)
                }
                return this.mapBuilder.finalize(ret, node);
            }
        } else {
            var nodep = [];

            // collect keys
            for (var i = 1; i < node.length; i += 2) {
                nodep.push(this.decode(node[i], cache, true, false));
                nodep.push(this.decode(node[i + 1], cache, false, false));
            }

            return types.map(nodep, false);
        }
    };

    decoder.Decoder.prototype.decodeArray = function (node, cache, asMapKey, tagValue) {
        if (tagValue) {
            var ret = [];
            for (var i = 0; i < node.length; i++) {
                ret.push(this.decode(node[i], cache, asMapKey, false));
            }
            return ret;
        } else {
            var cacheIdx = cache && cache.idx;
            // tagged value as 2-array case
            if ((node.length === 2) &&
                (typeof node[0] === "string")) {
                var tag = this.decode(node[0], cache, false, false);
                if (decoder.isTag(tag)) {
                    var val = node[1],
                        handler = this.handlers[tag.str];
                    if (handler != null) {
                        var ret = handler(this.decode(val, cache, asMapKey, true), this);
                        return ret;
                    } else {
                        return types.taggedValue(tag.str, this.decode(val, cache, asMapKey, false))
                    }
                }
            }

            // rewind cache
            if (cache && (cacheIdx != cache.idx)) {
                cache.idx = cacheIdx;
            }

            if (this.arrayBuilder) {
                // NOTE: hard coded for ClojureScript for now - David
                if (node.length <= 32 && this.arrayBuilder.fromArray) {
                    var arr = [];
                    for (var i = 0; i < node.length; i++) {
                        arr.push(this.decode(node[i], cache, asMapKey, false));
                    }
                    return this.arrayBuilder.fromArray(arr, node);
                } else {
                    var ret = this.arrayBuilder.init(node);
                    for (var i = 0; i < node.length; i++) {
                        ret = this.arrayBuilder.add(ret, this.decode(node[i], cache, asMapKey, false), node);
                    }
                    return this.arrayBuilder.finalize(ret, node);
                }
            } else {
                var ret = [];
                for (var i = 0; i < node.length; i++) {
                    ret.push(this.decode(node[i], cache, asMapKey, false));
                }
                return ret;
            }
        }
    };

    decoder.Decoder.prototype.parseString = function (string, cache, asMapKey) {
        if (string.charAt(0) === d.ESC) {
            var c = string.charAt(1);
            if (c === d.ESC || c === d.SUB || c === d.RES) {
                return string.substring(1);
            } else if (c === d.TAG) {
                return decoder.tag(string.substring(2));
            } else {
                var handler = this.handlers[c];
                if (handler == null) {
                    return this.defaultHandler(c, string.substring(2));
                } else {
                    return handler(string.substring(2), this);
                }
            }
        } else {
            return string;
        }
    };

    decoder.decoder = function (options) {
        return new decoder.Decoder(options);
    };

});

// com/cognitect/transit/impl/reader.js

goog.provide("com.cognitect.transit.impl.reader");

goog.scope(function () {

    var reader  = com.cognitect.transit.impl.reader,
        decoder = com.cognitect.transit.impl.decoder,
        caching = com.cognitect.transit.caching;

    /**
     * A JSON unmarshaller
     * @constructor
     */
    reader.JSONUnmarshaller = function Transit$JSONUnmarshaller(opts) {
        this.decoder = new decoder.Decoder(opts);
    };

    /**
     * @param {string} str a JSON string
     * @param {caching.ReadCache} cache a read cache
     * @returns {*}
     */
    reader.JSONUnmarshaller.prototype.unmarshal = function (str, cache) {
        return this.decoder.decode(JSON.parse(str), cache);
    };

    /**
     * A transit reader
     * @constructor
     * @param {reader.JSONUnmarshaller} unmarshaller
     * @param {Object=} options
     */
    reader.Reader = function Transit$Reader(unmarshaller, options) {
        this.unmarshaller = unmarshaller;
        this.options = options || {};
        this.cache = this.options["cache"] ? this.options["cache"] : new caching.ReadCache();
    };

    /**
     * @param {string} str a string to be read
     * @returns {*}
     */
    reader.Reader.prototype.read = function (str) {
        var ret = this.unmarshaller.unmarshal(str, this.cache)
        this.cache.clear();
        return ret;
    };
    reader.Reader.prototype["read"] = reader.Reader.prototype.read;

});

// com/cognitect/transit/impl/writer.js

goog.provide("com.cognitect.transit.impl.writer");

goog.scope(function () {

    var writer   = com.cognitect.transit.impl.writer,
        util     = com.cognitect.transit.util,
        caching  = com.cognitect.transit.caching,
        handlers = com.cognitect.transit.handlers,
        types    = com.cognitect.transit.types,
        d        = com.cognitect.transit.delimiters,
        Long     = goog.math.Long;

    writer.escape = function (string) {
        if (string.length > 0) {
            var c = string.charAt(0);
            if (c === d.ESC || c === d.SUB || c === d.RES) {
                return d.ESC + string;
            } else {
                return string;
            }
        } else {
            return string;
        }
    };

    /**
     * @constructor
     */
    writer.JSONMarshaller = function Transit$JSONMarshaller(opts) {
        this.opts = opts || {};
        this.preferStrings = this.opts["preferStrings"] != null ? this.opts["preferStrings"] : true;

        this.objectBuilder = this.opts["objectBuilder"] || null;
        this.transform = this.opts["transform"] || null;

        this.handlers = new handlers.Handlers();

        var optsHandlers = this.opts["handlers"];
        if (optsHandlers) {
            if (util.isArray(optsHandlers) || !optsHandlers.forEach) {
                throw new Error("transit writer \"handlers\" option must be a map");
            }
            var self = this;
            optsHandlers.forEach(function (v, k) {
                if (k !== undefined) {
                    self.handlers.set(k, v);
                } else {
                    throw new Error("Cannot create handler for JavaScript undefined");
                }
            });
        }

        // Multiple JS context helper
        this.handlerForForeign = this.opts["handlerForForeign"];

        this.unpack = this.opts["unpack"] || function (x) {
                if (types.isArrayMap(x) && x.backingMap === null) {
                    return x._entries;
                } else {
                    return false;
                }
            };

        this.verbose = (this.opts && this.opts["verbose"]) || false;
    };

    writer.JSONMarshaller.prototype.handler = function (obj) {
        var h = this.handlers.get(handlers.constructor(obj));

        if (h != null) {
            return h;
        } else {
            var tag = obj && obj["transitTag"];
            if (tag) {
                return this.handlers.get(tag)
            } else {
                return null;
            }
        }
    };

    writer.JSONMarshaller.prototype.registerHandler = function (ctor, handler) {
        this.handlers.set(ctor, handler);
    };

    writer.JSONMarshaller.prototype.emitNil = function (asMapKey, cache) {
        if (asMapKey) {
            return this.emitString(d.ESC, "_", "", asMapKey, cache);
        } else {
            return null;
        }
    };

    writer.JSONMarshaller.prototype.emitString = function (prefix, tag, s, asMapKey, cache) {
        var string = prefix + tag + s;
        if (cache) {
            return cache.write(string, asMapKey);
        } else {
            return string;
        }
    };

    writer.JSONMarshaller.prototype.emitBoolean = function (b, asMapKey, cache) {
        if (asMapKey) {
            var s = b.toString();
            return this.emitString(d.ESC, "?", s[0], asMapKey, cache);
        } else {
            return b;
        }
    };

    writer.JSONMarshaller.prototype.emitInteger = function (i, asMapKey, cache) {
        if (i === Infinity) {
            return this.emitString(d.ESC, "z", "INF", asMapKey, cache);
        } else if (i === -Infinity) {
            return this.emitString(d.ESC, "z", "-INF", asMapKey, cache);
        } else if (isNaN(i)) {
            return this.emitString(d.ESC, "z", "NaN", asMapKey, cache);
        } else if (asMapKey || (typeof i === "string") || (i instanceof Long)) {
            return this.emitString(d.ESC, "i", i.toString(), asMapKey, cache);
        } else {
            return i;
        }
    };

    writer.JSONMarshaller.prototype.emitDouble = function (d, asMapKey, cache) {
        if (asMapKey) {
            return this.emitString(d.ESC, "d", d, asMapKey, cache);
        } else {
            return d;
        }
    };

    writer.JSONMarshaller.prototype.emitBinary = function (b, asMapKey, cache) {
        return this.emitString(d.ESC, "b", b, asMapKey, cache);
    };

    writer.JSONMarshaller.prototype.emitQuoted = function (em, obj, cache) {
        if (em.verbose) {
            var ret = {},
                k = this.emitString(d.ESC_TAG, "'", "", true, cache);
            ret[k] = writer.marshal(this, obj, false, cache);
            return ret;
        } else {
            return [this.emitString(d.ESC_TAG, "'", "", true, cache), writer.marshal(this, obj, false, cache)];
        }
    };

    writer.emitObjects = function (em, iterable, cache) {
        var ret = [];
        if (util.isArray(iterable)) {
            for (var i = 0; i < iterable.length; i++) {
                ret.push(writer.marshal(em, iterable[i], false, cache));
            }
        } else {
            iterable.forEach(function (v, i) {
                ret.push(writer.marshal(em, v, false, cache));
            });
        }
        return ret;
    };

    writer.emitArray = function (em, iterable, skip, cache) {
        return writer.emitObjects(em, iterable, cache);
    };

    writer.isStringableKey = function (em, k) {
        if (typeof k !== "string") {
            var h = em.handler(k);
            return h && h.tag(k).length === 1;
        } else {
            return true;
        }
    };

    /**
     * Returns true if map-like obj parameter has only stringable keys -
     * strings, symbols or keywords. If false, obj is a cmap value.
     * @param em
     * @param obj
     * @returns {boolean}
     */
    writer.stringableKeys = function (em, obj) {
        var arr = em.unpack(obj),
            stringableKeys = true;

        if (arr) {
            for (var i = 0; i < arr.length; i += 2) {
                stringableKeys = writer.isStringableKey(em, arr[i]);
                if (!stringableKeys) {
                    break;
                }
            }
            return stringableKeys;
        } else if (obj.keys) {
            var iter = obj.keys(),
                step = null;

            if (iter.next) {
                step = iter.next();
                while (!step.done) {
                    stringableKeys = writer.isStringableKey(em, step.value);
                    if (!stringableKeys) {
                        break;
                    }
                    step = iter.next();
                }
                return stringableKeys;
            }
        }

        if (obj.forEach) {
            obj.forEach(function (v, k) {
                stringableKeys = stringableKeys && writer.isStringableKey(em, k);
            });
            return stringableKeys;
        } else {
            throw new Error("Cannot walk keys of object type " + handlers.constructor(obj).name);
        }
    };

    /**
     * Returns true if x is an Object instance from a different JavaScript
     * context.
     * @param x
     * @returns {boolean}
     */
    writer.isForeignObject = function (x) {
        if (x.constructor["transit$isObject"]) {
            return true;
        }

        var ret = x.constructor.toString();

        ret = ret.substr('function '.length);
        ret = ret.substr(0, ret.indexOf('('));
        var isObject = ret == "Object";

        if (typeof Object.defineProperty != "undefined") {
            Object.defineProperty(x.constructor, "transit$isObject", {
                value: isObject,
                enumerable: false
            });
        } else {
            x.constructor["transit$isObject"] = isObject;
        }

        return isObject;
    };

    writer.emitMap = function (em, obj, skip, cache) {
        var arr = null, rep = null, tag = null, ks = null, i = 0;

        if ((obj.constructor === Object) ||
            (obj.forEach != null) ||
            (em.handlerForForeign && writer.isForeignObject(obj))) {
            if (em.verbose) {
                if (obj.forEach != null) {
                    if (writer.stringableKeys(em, obj)) {
                        var ret = {};
                        obj.forEach(function (v, k) {
                            ret[writer.marshal(em, k, true, false)] = writer.marshal(em, v, false, cache);
                        });
                        return ret;
                    } else {
                        arr = em.unpack(obj);
                        rep = [];
                        tag = em.emitString(d.ESC_TAG, "cmap", "", true, cache);
                        if (arr) {
                            for (; i < arr.length; i += 2) {
                                rep.push(writer.marshal(em, arr[i], false, false));
                                rep.push(writer.marshal(em, arr[i + 1], false, cache));
                            }
                        } else {
                            obj.forEach(function (v, k) {
                                rep.push(writer.marshal(em, k, false, false));
                                rep.push(writer.marshal(em, v, false, cache));
                            });
                        }
                        ret = {};
                        ret[tag] = rep;
                        return ret;
                    }
                } else {
                    ks = util.objectKeys(obj);
                    ret = {};
                    for (; i < ks.length; i++) {
                        ret[writer.marshal(em, ks[i], true, false)] = writer.marshal(em, obj[ks[i]], false, cache);
                    }
                    return ret;
                }
            } else {
                if (obj.forEach != null) {
                    if (writer.stringableKeys(em, obj)) {
                        arr = em.unpack(obj);
                        ret = ["^ "];
                        if (arr) {
                            for (; i < arr.length; i += 2) {
                                ret.push(writer.marshal(em, arr[i], true, cache));
                                ret.push(writer.marshal(em, arr[i + 1], false, cache));
                            }
                        } else {
                            obj.forEach(function (v, k) {
                                ret.push(writer.marshal(em, k, true, cache));
                                ret.push(writer.marshal(em, v, false, cache));
                            });
                        }
                        return ret;
                    } else {
                        arr = em.unpack(obj);
                        rep = [];
                        tag = em.emitString(d.ESC_TAG, "cmap", "", true, cache);
                        if (arr) {
                            for (; i < arr.length; i += 2) {
                                rep.push(writer.marshal(em, arr[i], false, cache));
                                rep.push(writer.marshal(em, arr[i + 1], false, cache));
                            }
                        } else {
                            obj.forEach(function (v, k) {
                                rep.push(writer.marshal(em, k, false, cache));
                                rep.push(writer.marshal(em, v, false, cache));
                            });
                        }
                        return [tag, rep];
                    }
                } else {
                    ret = ["^ "];
                    ks = util.objectKeys(obj);
                    for (; i < ks.length; i++) {
                        ret.push(writer.marshal(em, ks[i], true, cache));
                        ret.push(writer.marshal(em, obj[ks[i]], false, cache));
                    }
                    return ret;
                }
            }
        } else if (em.objectBuilder != null) {
            return em.objectBuilder(obj, function (k) {
                    return writer.marshal(em, k, true, cache);
                },
                function (v) {
                    return writer.marshal(em, v, false, cache);
                });
        } else {
            var name = handlers.constructor(obj).name,
                err = new Error("Cannot write " + name);
            err.data = {obj: obj, type: name};
            throw err;
        }
    };

    writer.emitTaggedMap = function (em, tag, rep, skip, cache) {
        if (em.verbose) {
            var ret = {};
            ret[em.emitString(d.ESC_TAG, tag, "", true, cache)] = writer.marshal(em, rep, false, cache);
            return ret;
        } else {
            return [em.emitString(d.ESC_TAG, tag, "", true, cache), writer.marshal(em, rep, false, cache)];
        }
    };

    writer.emitEncoded = function (em, h, tag, rep, obj, asMapKey, cache) {
        if (tag.length === 1) {
            if (typeof rep === "string") {
                return em.emitString(d.ESC, tag, rep, asMapKey, cache);
            } else if (asMapKey || em.preferStrings) {
                var vh = em.verbose && h.getVerboseHandler();
                if (vh) {
                    tag = vh.tag(obj);
                    rep = vh.stringRep(obj, vh);
                } else {
                    rep = h.stringRep(obj, h);
                }
                if (rep !== null) {
                    return em.emitString(d.ESC, tag, rep, asMapKey, cache);
                } else {
                    var err = new Error("Tag \"" + tag + "\" cannot be encoded as string");
                    err.data = {tag: tag, rep: rep, obj: obj};
                    throw err;
                }
            } else {
                return writer.emitTaggedMap(em, tag, rep, asMapKey, cache);
            }
        } else {
            return writer.emitTaggedMap(em, tag, rep, asMapKey, cache);
        }
    };

    writer.marshal = function (em, obj, asMapKey, cache) {
        if(em.transform !== null) {
            obj = em.transform(obj);
        }

        var h = em.handler(obj) || (em.handlerForForeign ? em.handlerForForeign(obj, em.handlers) : null),
            tag = h ? h.tag(obj) : null,
            rep = h ? h.rep(obj) : null;

        if (h != null && tag != null) {
            switch (tag) {
                case "_":
                    return em.emitNil(asMapKey, cache);
                    break;
                case "s":
                    return em.emitString("", "", writer.escape(rep), asMapKey, cache);
                    break;
                case "?":
                    return em.emitBoolean(rep, asMapKey, cache);
                    break;
                case "i":
                    return em.emitInteger(rep, asMapKey, cache);
                    break;
                case "d":
                    return em.emitDouble(rep, asMapKey, cache);
                    break;
                case "b":
                    return em.emitBinary(rep, asMapKey, cache);
                    break;
                case "'":
                    return em.emitQuoted(em, rep, cache);
                    break;
                case "array":
                    return writer.emitArray(em, rep, asMapKey, cache);
                    break;
                case "map":
                    return writer.emitMap(em, rep, asMapKey, cache);
                    break;
                default:
                    return writer.emitEncoded(em, h, tag, rep, obj, asMapKey, cache);
                    break;
            }
        } else {
            var name = handlers.constructor(obj).name,
                err = new Error("Cannot write " + name);
            err.data = {obj: obj, type: name};
            throw err;
        }
    };

    writer.maybeQuoted = function (em, obj) {
        var h = em.handler(obj) || (em.handlerForForeign ? em.handlerForForeign(obj, em.handlers) : null);

        if (h != null) {
            if (h.tag(obj).length === 1) {
                return types.quoted(obj);
            } else {
                return obj;
            }
        } else {
            var name = handlers.constructor(obj).name,
                err = new Error("Cannot write " + name);
            err.data = {obj: obj, type: name};
            throw err;
        }
    };

    writer.marshalTop = function (em, obj, asMapKey, cache) {
        return JSON.stringify(writer.marshal(em, writer.maybeQuoted(em, obj), asMapKey, cache));
    };

    /**
     * @constructor
     */
    writer.Writer = function Transit$Writer(marshaller, options) {
        this._marshaller = marshaller;
        this.options = options || {};
        if (this.options["cache"] === false) {
            this.cache = null;
        } else {
            this.cache = this.options["cache"] ? this.options["cache"] : new caching.WriteCache();
        }
    };

    writer.Writer.prototype.marshaller = function () {
        return this._marshaller;
    };
    writer.Writer.prototype["marshaller"] = writer.Writer.prototype.marshaller;

    writer.Writer.prototype.write = function (obj, opts) {
        var ret = null,
            ropts = opts || {},
            asMapKey = ropts["asMapKey"] || false,
            cache = this._marshaller.verbose ? false : this.cache;

        if (ropts["marshalTop"] === false) {
            ret = writer.marshal(this._marshaller, obj, asMapKey, cache)
        } else {
            ret = writer.marshalTop(this._marshaller, obj, asMapKey, cache)
        }
        if (this.cache != null) {
            this.cache.clear();
        }
        return ret;
    };
    writer.Writer.prototype["write"] = writer.Writer.prototype.write;

    writer.Writer.prototype.register = function (type, handler) {
        this._marshaller.registerHandler(type, handler);
    };
    writer.Writer.prototype["register"] = writer.Writer.prototype.register;

});

// com/cognitect/transit.js

goog.provide("com.cognitect.transit");

/** @define {boolean} */

/** @define {boolean} */

/** @define {boolean} */

/** @define {boolean} */

goog.scope(function() {

    /**
     * @class transit
     */
    var transit = com.cognitect.transit;

    var util    = com.cognitect.transit.util,
        reader  = com.cognitect.transit.impl.reader,
        writer  = com.cognitect.transit.impl.writer,
        decoder = com.cognitect.transit.impl.decoder,
        types   = com.cognitect.transit.types,
        eq      = com.cognitect.transit.eq,
        caching = com.cognitect.transit.caching;

    /**
     * @typedef {Map|com.cognitect.transit.types.TransitArrayMap|com.cognitect.transit.types.TransitMap}
     */
    transit.MapLike;

    /**
     * @typedef {Set|com.cognitect.transit.types.TransitSet}
     */
    transit.SetLike;

    /**
     * Create a transit reader instance.
     * @method transit.reader
     * @param {string=} type
     *     type of reader to construct.  Default to "json". For verbose mode
     *     supply "json-verbose".
     * @param {Object=} opts
     *     reader options. A JavaScript object to customize the writer Valid
     *     entries include "defaultHandler", and "handler". "defaultHandler"
     *     should be JavaScript function taking two arguments, the first is the
     *     tag, the second the value. "handlers" should be an object of tags to
     *     handle. The values are functions that will receive the value of matched
     *     tag. "preferBuffers" may be supplied to customize binary
     *     decoding. If available binary data will read as Node.js Buffers,
     *     If Buffer is not available or "prefersBuffers" is set to false
     *     data will be read as Uint8Array. If neither Buffer nor Uint8Array is
     *     available - defaults to tagged value that simply wraps the
     *     base64 encoded string.
     * @return {com.cognitect.transit.impl.reader.Reader} A transit reader.
     * @example
     *     var r = transit.reader("json", {
     *         handlers: {
     *            "point": function(v) { return new Point(v[0], v[1]); }
     *         }
     *     });
     */
    transit.reader = function(type, opts) {
        if(type === "json" || type === "json-verbose" || type == null) {
            type = "json";
            var unmarshaller = new reader.JSONUnmarshaller(opts);
            return new reader.Reader(unmarshaller, opts);
        } else {
            throw new Error("Cannot create reader of type " + type);
        }
    };

    /**
     * Create a transit writer instance.
     * @method transit.writer
     * @param {string=} type
     *     type of writer to construct. Defaults to "json". For verbose mode
     *     supply "json-verbose".
     * @param {Object=} opts
     *     writer options. A JavaScript object to customize the writer.
     *     "handlers" options, a transit.map of JavaScript constructor and
     *     transit writer handler instance entries. "handlerForForeign" option,
     *     for dealing with values from other JavaScript contexts. This function
     *     will be passed the unmatchable value and the installed handlers. The
     *     function should return the correct handler. Note if this function is
     *     provided, special handling for Objects will also be
     *     auto-installed to catch plain Objects from the foreign context.
     * @return {com.cognitect.transit.impl.writer.Writer} A transit writer.
     * @example
     *     var r = transit.writer("json", {
     *         handlers: transit.map([
     *            Point, PointHandler
     *         ])
     *     });
     */
    transit.writer = function(type, opts) {
        if(type === "json" || type === "json-verbose" || type == null) {
            if(type === "json-verbose") {
                if(opts == null) opts = {};
                opts["verbose"] = true;
            }
            var marshaller = new writer.JSONMarshaller(opts);
            return new writer.Writer(marshaller, opts);
        } else {
            var err = new Error("Type must be \"json\"");
            err.data = {type: type};
            throw err;
        }
    };

    /**
     * Create a transit writer handler.
     * @method transit.makeWriteHandler
     * @param {Object} obj
     *    An object containing 3 functions, tag, rep and stringRep. "tag" should
     *    return a string representing the tag to be written on the wire. "rep"
     *    should return the representation on the wire. "stringRep" is should
     *    return the string representation of the value. Optional
     *    "getVerboseHandler" should return a handler for writing verbose output.
     * @return {Object} A transit write handler.
     * @example
     *     var PointHandler = transit.makeWriteHandler({
     *          tag: function(p) { return "point"; },
     *          rep: function(p) { return [p.x, p.y]; },
     *          stringRep: function(p) { return null; }
     *     });
     */
    transit.makeWriteHandler = function(obj) {
        /** @constructor */
        var Handler = function(){};
        Handler.prototype.tag = obj["tag"];
        Handler.prototype.rep = obj["rep"];
        Handler.prototype.stringRep = obj["stringRep"];
        Handler.prototype.getVerboseHandler = obj["getVerboseHandler"];
        return new Handler();
    };

    transit.makeBuilder = function(obj) {
        /** @constructor */
        var Builder = function(){};
        Builder.prototype.init = obj["init"];
        Builder.prototype.add = obj["add"];
        Builder.prototype.finalize = obj["finalize"];
        Builder.prototype.fromArray = obj["fromArray"];
        return new Builder();
    };

    /**
     * Create a transit date.
     * @method transit.date
     * @param {number|string} x
     *     A number or string representing milliseconds since epoch.
     * @return {Date} A JavaScript Date.
     */
    transit.date = types.date;

    /**
     * Create an integer. If given a transit integer or a JavaScript
     *     number will simply return that value. Given a string will
     *     return a JavaScript number if the string represents an integer
     *     value in the 53bit range and a transit integer otherwise.
     * @method transit.integer
     * @param {number|string} s
     *     A value representing an integer.
     * @return {number|goog.math.Long} A JavaScript number or transit integer.
     */
    transit.integer = types.intValue;

    /**
     * Test if an object is a transit integer. Will return true if argument
     * is a 64 bit integer or a JavaScript number that has an interpretation as
     * an integer value, i.e. parseFloat(n) === parseInt(n)
     * @method transit.isInteger
     * @param {*} x
     *     Any JavaScript value.
     * @return {boolean} true if the value is a transit integer, false otherwise.
     */
    transit.isInteger = types.isInteger;

    /**
     * Create transit UUID from a string
     * @method transit.uuid
     * @param {string} s
     *     A string.
     * @return {com.cognitect.transit.types.UUID} A transit UUID.
     */
    transit.uuid = types.uuid;

    /**
     * Test if an object is a transit UUID.
     * @method transit.isUUID
     * @param {*} x
     *     Any JavaScript value.
     * @return {boolean} true if the vlaue is a transit UUID instance, false otherwise.
     */
    transit.isUUID = types.isUUID;

    /**
     * Create a transit big integer.
     * @method transit.bigInt
     * @param {string} s
     *     A string representing an arbitrary size integer value.
     * @return {com.cognitect.transit.types.TaggedValue} A transit big integer.
     */
    transit.bigInt =  types.bigInteger;

    /**
     * Test if an object is a transit big integer.
     * @method transit.isBigInt
     * @param {*} x
     *     Any JavaScript value.
     * @return {boolean} true if x is a transit big integer, false otherwise.
     */
    transit.isBigInt = types.isBigInteger;

    /**
     * Create a transit big decimal.
     * @method transit.bigDec
     * @param {string} s
     *     A string representing an arbitrary precisions decimal value.
     * @return {com.cognitect.transit.types.TaggedValue} A transit big decimal.
     */
    transit.bigDec =  types.bigDecimalValue;

    /**
     * Test if an object is a transit big decimal.
     * @method transit.isBigDec
     * @param {*} x
     *     Any JavaScript value.
     * @return {boolean} true if x is a transit big decimal, false otherwise.
     */
    transit.isBigDec = types.isBigDecimal;

    /**
     * Create transit keyword.
     * @method transit.keyword
     * @param {string} name A string.
     * @return {com.cognitect.transit.types.Keyword} A transit keyword.
     * @example
     *     transit.keyword("foo");
     */
    transit.keyword = types.keyword;

    /**
     * Test if an object is a transit keyword.
     * @method transit.isKeyword
     * @param {*} x
     *     Any JavaScript value.
     * @return {boolean} true if x is a transit keyword, false otherwise.
     */
    transit.isKeyword = types.isKeyword;

    /**
     * Create a transit symbol.
     * @method transit.symbol
     * @param {string} name
     *     A string.
     * @return {com.cognitect.transit.types.Symbol} A transit symbol instance.
     * @example
     *     transit.symbol("foo");
     */
    transit.symbol = types.symbol;

    /**
     * Test if an object is a transit symbol
     * @method transit.isSymbol
     * @param {*} x
     *     Any JavaScript value.
     * @return {boolean} true if x is a transit symbol, false otherwise.
     */
    transit.isSymbol = types.isSymbol;

    /**
     * Create transit binary blob.
     * @method transit.binary
     * @param {string} s
     *     A base64 encoded string.
     * @param {*=} decoder
     *     A Transit compliant decoder
     * @return {com.cognitect.transit.types.TaggedValue|Uint8Array} A transit binary blob instance.
     */
    transit.binary = types.binary;

    /**
     * Test if an object is a transit binary blob.
     * @method transit.isBinary
     * @param {*} x
     *     Any JavaScript value.
     * @return {Boolean} true if x is a binary value, false otheriwse.
     */
    transit.isBinary = types.isBinary;

    /**
     * Create a transit URI.
     * @method transit.uri
     * @param {string} s
     *     A string representing a valid URI.
     * @return {com.cognitect.transit.types.TaggedValue} A transit URI.
     */
    transit.uri = types.uri;

    /**
     * Test if an object is a transit URI.
     * @method transit.isURI
     * @param {*} x
     *     Any JavaScript value.
     * @return {Boolean} true if x is a transit symbol, false otherwise.
     */
    transit.isURI = types.isURI;

    /**
     * Create a transit hash map. Transit maps satisfy the current version
     *     of the ECMAScript 6 Map specification.
     * @method transit.map
     * @param {Array=} xs
     *     A JavaScript array of alternating key value pairs.
     * @return {com.cognitect.transit.MapLike} A transit map.
     * @example
     *     transit.map([new Date(), "foo", [1,2], 3]);
     */
    transit.map = types.map;

    /**
     * Test if an object is a transit map.
     * @method transit.isMap
     * @param {*} x
     *     Any JavaScript value.
     * @return {boolean} true if x is a transit map, false otherwise.
     */
    transit.isMap = types.isMap;

    /**
     * Create a transit set. Transit sets satisfy the current version of the
     *     of the ECMAScript 6 Set specification.
     * @method transit.set
     * @param {Array=} xs
     *     A JavaScript array of values.
     * @return {com.cognitect.transit.SetLike} A transit set.
     * @example
     *     transit.set(["foo", [1,2], 3, {bar: "baz"}]);
     */
    transit.set = types.set;

    /**
     * Test if an object is a transit set.
     * @method transit.isSet
     * @param {*} x
     *     Any JavaScript value.
     * @return {boolean} true if x is a transit set, false otherwise.
     */
    transit.isSet = types.isSet;

    /**
     * Create a transit list.
     * @method transit.list
     * @param {Array} xs
     *     A JavaScript array.
     * @return {com.cognitect.transit.types.TaggedValue} A transit list.
     */
    transit.list = types.list;

    /**
     * Test if an object is a transit list.
     * @method transit.isList
     * @param {*} x
     *     Any JavaScript value.
     * @return {boolean} true if x is a transit list, false otherwise.
     */
    transit.isList = types.isList;

    /**
     * Create a transit quoted value.
     * @method transit.quoted
     * @param {*} x
     *     Any JavaScript value.
     * @return {com.cognitect.transit.types.TaggedValue} A transit quoted value.
     */
    transit.quoted = types.quoted;

    /**
     * Test if an object is a transit quoted value.
     * @method transit.isQuoted
     * @param {*} x
     *     Any JavaScript value.
     * @return {boolean} true if x is a transit value, false otherwise.
     */
    transit.isQuoted = types.isQuoted;

    /**
     * Create a transit tagged value.
     * @method transit.tagged
     * @param {string} tag A tag.
     * @param {*} value
     *     A JavaScrpt array, object, or string.
     * @return {com.cognitect.transit.types.TaggedValue} A transit tagged value.
     * @example
     *     transit.tagged("point", new Point(1,2));
     */
    transit.tagged = types.taggedValue;

    /**
     * Test if an object is a transit tagged value.
     * @method transit.isTaggedValue
     * @param {*} x
     *     Any JavaScript value.
     * @return {boolean} true if x is a transit value, false otherwise.
     */
    transit.isTaggedValue =  types.isTaggedValue;

    /**
     * Create a transit link.
     * @method transit.link
     * @param {com.cognitect.transit.MapLike} m
     *     A transit map which must contain at a minimum the following keys:
     *     href, rel. It may optionally include name, render, and prompt. href
     *     must be a transit.uri, all other values are strings, and render must
     *     be either "image" or "link".
     * @return {Object} A transit link.
     */
    transit.link = types.link;

    /**
     * Test if an object is a transit link.
     * @method transit.isLink
     * @param {*} x
     *     Any JavaScript object.
     * @return {boolean} true if x is a transit link, false otherwise.
     */
    transit.isLink = types.isLink;

    /**
     * Compute the hashCode for any JavaScript object that has been
     *    extend to transit's equality and hashing protocol. JavaScript
     *    primitives and transit value are already extended to this protocol.
     *    Custom types may be extended to the protocol via transit.extenToEQ.
     * @method transit.hash
     * @param {*} x
     *    Any JavaScript object that has been extended to transit's equality
     *    and hashing protocol.
     * @return {number} Returns JavaScript number - semantically a 32bit integer.
     */
    transit.hash = eq.hashCode;

    /**
     * Compute the hashCode for JavaScript map-like types - either a JavaScript
     *    object or a JavaScript object that implements ES6 Map forEach.
     * @method transit.hashMapLike
     * @param {Object|com.cognitect.transit.MapLike} x
     *    A plain JavaScript Object or Object that implements ES6 Map forEach.
     * @return {number} Returns JavaScript number - semantically a 32bit integer.
     */
    transit.hashMapLike = eq.hashMapLike;

    /**
     * Compute the hashCode for JavaScript array-like types - either a JavaScript
     *    array or a JavaScript object that implements Array forEach.
     * @method transit.hashArrayLike
     * @param {Object} x
     *    A JavaScript Array or Object that implements Array forEach.
     * @return {number} Returns JavaScript number - semantically a 32bit integer.
     */
    transit.hashArrayLike = eq.hashArrayLike;

    /**
     * Test whether two JavaScript objects represent equal values. The
     *    objects to be tested should be extended to transit's equality
     *    and hasing protocol. JavaScript natives and transit value have
     *    already been extended to the protocol, including objects and
     *    arrays.  Also transit maps and JavaScript objects may be
     *    compared for equality. Custom types may be extended via
     *    transit.extendToEQ.
     * @param {*} x
     *     A JavaScript object
     * @param {*} y
     *     A JavaScript object
     * @return {Boolean} true if the x and y are equal, false otherwise.
     */
    transit.equals = eq.equals;

    /**
     * Extend an object to hashing and equality required by
     *     transit maps and sets. Only required for custom
     *     types, JavaScript primitive types and transit
     *     types are handled.
     * @method transit.extendToEQ
     * @param {*} x
     *     A JavaScript object, will be mutated.
     * @param {{hashCode: function(), equals: function(*,*):boolean}}
     *     A JavaScript object supplying `hashCode` and `equals`
     *     implementations
     * @return {*} x
     * @example
     *     transit.extendToEq(Point.protototype, {
     *         hashCode: function() {
     *             var bits = (this.x | 0) ^ ((this.y | 0) * 31);
     *             return bits ^ (bits >>> 32);
     *         },
     *         equals: function(other) {
     *             return this.x == other.x && this.y == other.y;
     *         }
     *     });
     */
    transit.extendToEQ = eq.extendToEQ;

    /**
     * Convert a transit map instance into a JavaScript Object.
     * Throws if the map has keys which have no string representation.
     * @method transit.mapToObject
     * @param {com.cognitect.transit.MapLike} m
     *     a transit map
     * @return {Object} a JavaScript Object
     */
    transit.mapToObject = function(m) {
        var ret = {};
        m.forEach(function(v, k) {
            if(typeof k !== "string") {
                throw Error("Cannot convert map with non-string keys");
            } else {
                ret[k] = v;
            }
        });
        return ret;
    };

    /**
     * Convert a POJO into a transit map.
     * @method transit.objectToMap
     * @param {Object} obj
     *     a JavaScript Object
     * @return {com.cognitect.transit.MapLike} a transit map
     */
    transit.objectToMap = function(obj) {
        var ret = transit.map();
        for(var p in obj) {
            if(obj.hasOwnProperty(p)) {
                ret.set(p, obj[p]);
            }
        }
        return ret;
    };

    /**
     * Construct a Transit JSON decoder.
     * @method transit.decoder
     * @param {Object} opts
     *     options to the decoder. Can include map of
     *     handlers.
     * @return {com.cognitect.transit.impl.decoder.Decoder} a Transit JSON decoder
     * @example
     *     var decoder = transit.decoder();
     *     var x = decoder.decode(json, transit.readCache());
     */
    transit.decoder = decoder.decoder;

    /**
     * Construct a Transit read cache
     * @method transit.readCache
     * @return {com.cognitect.transit.caching.ReadCache} a Transit read cache
     */
    transit.readCache = caching.readCache;

    /**
     * Construct a Transit write cache
     * @method transit.writeCache
     * @return {com.cognitect.transit.caching.WriteCache} a Transit write cache
     */
    transit.writeCache = caching.writeCache;

    transit.UUIDfromString = types.UUIDfromString;
    transit.randomUUID = util.randomUUID;
    transit.stringableKeys = writer.stringableKeys;

    if(TRANSIT_BROWSER_TARGET) {
        goog.exportSymbol("transit.reader",         transit.reader);
        goog.exportSymbol("transit.writer",         transit.writer);
        goog.exportSymbol("transit.makeBuilder",    transit.makeBuilder);
        goog.exportSymbol("transit.makeWriteHandler", transit.makeWriteHandler);
        goog.exportSymbol("transit.date",           types.date);
        goog.exportSymbol("transit.integer",        types.intValue);
        goog.exportSymbol("transit.isInteger",      types.isInteger);
        goog.exportSymbol("transit.uuid",           types.uuid);
        goog.exportSymbol("transit.isUUID",         types.isUUID);
        goog.exportSymbol("transit.bigInt",         types.bigInteger);
        goog.exportSymbol("transit.isBigInt",       types.isBigInteger);
        goog.exportSymbol("transit.bigDec",         types.bigDecimalValue);
        goog.exportSymbol("transit.isBigDec",       types.isBigDecimal);
        goog.exportSymbol("transit.keyword",        types.keyword);
        goog.exportSymbol("transit.isKeyword",      types.isKeyword);
        goog.exportSymbol("transit.symbol",         types.symbol);
        goog.exportSymbol("transit.isSymbol",       types.isSymbol);
        goog.exportSymbol("transit.binary",         types.binary);
        goog.exportSymbol("transit.isBinary",       types.isBinary);
        goog.exportSymbol("transit.uri",            types.uri);
        goog.exportSymbol("transit.isURI",          types.isURI);
        goog.exportSymbol("transit.map",            types.map);
        goog.exportSymbol("transit.isMap",          types.isMap);
        goog.exportSymbol("transit.set",            types.set);
        goog.exportSymbol("transit.isSet",          types.isSet);
        goog.exportSymbol("transit.list",           types.list);
        goog.exportSymbol("transit.isList",         types.isList);
        goog.exportSymbol("transit.quoted",         types.quoted);
        goog.exportSymbol("transit.isQuoted",       types.isQuoted);
        goog.exportSymbol("transit.tagged",         types.taggedValue);
        goog.exportSymbol("transit.isTaggedValue",  types.isTaggedValue);
        goog.exportSymbol("transit.link",           types.link);
        goog.exportSymbol("transit.isLink",         types.isLink);
        goog.exportSymbol("transit.hash",           eq.hashCode);
        goog.exportSymbol("transit.hashMapLike",    eq.hashMapLike);
        goog.exportSymbol("transit.hashArrayLike",  eq.hashArrayLike);
        goog.exportSymbol("transit.equals",         eq.equals);
        goog.exportSymbol("transit.extendToEQ",     eq.extendToEQ);
        goog.exportSymbol("transit.mapToObject",    transit.mapToObject);
        goog.exportSymbol("transit.objectToMap",    transit.objectToMap);
        goog.exportSymbol("transit.decoder",        decoder.decoder);
        goog.exportSymbol("transit.UUIDfromString", types.UUIDfromString);
        goog.exportSymbol("transit.randomUUID",     util.randomUUID);
        goog.exportSymbol("transit.stringableKeys", writer.stringableKeys);
        goog.exportSymbol("transit.readCache",      caching.readCache);
        goog.exportSymbol("transit.writeCache",     caching.writeCache);
    }

    if(TRANSIT_NODE_TARGET) {
        module.exports = {
            reader:         transit.reader,
            writer:         transit.writer,
            makeBuilder:    transit.makeBuilder,
            makeWriteHandler: transit.makeWriteHandler,
            date:           types.date,
            integer:        types.intValue,
            isInteger:      types.isInteger,
            uuid:           types.uuid,
            isUUID:         types.isUUID,
            bigInt:         types.bigInteger,
            isBigInt:       types.isBigInteger,
            bigDec:         types.bigDecimalValue,
            isBigDec:       types.isBigDecimal,
            keyword:        types.keyword,
            isKeyword:      types.isKeyword,
            symbol:         types.symbol,
            isSymbol:       types.isSymbol,
            binary:         types.binary,
            isBinary:       types.isBinary,
            uri:            types.uri,
            isURI:          types.isURI,
            map:            types.map,
            isMap:          types.isMap,
            set:            types.set,
            isSet:          types.isSet,
            list:           types.list,
            isList:         types.isList,
            quoted:         types.quoted,
            isQuoted:       types.isQuoted,
            tagged:         types.taggedValue,
            isTaggedValue:  types.isTaggedValue,
            link:           types.link,
            isLink:         types.isLink,
            hash:           eq.hashCode,
            hashArrayLike:  eq.hashArrayLike,
            hashMapLike:    eq.hashMapLike,
            equals:         eq.equals,
            extendToEQ:     eq.extendToEQ,
            mapToObject:    transit.mapToObject,
            objectToMap:    transit.objectToMap,
            decoder:        decoder.decoder,
            UUIDfromString: types.UUIDfromString,
            randomUUID:     util.randomUUID,
            stringableKeys: writer.stringableKeys,
            readCache:      caching.readCache,
            writeCache:     caching.writeCache
        };
    }
});

const { transit } = com.cognitect;
const { types, eq } = transit;
export { transit, types, eq };
