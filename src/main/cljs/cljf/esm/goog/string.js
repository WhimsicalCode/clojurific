// Copyright 2006 The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The subset of goog.string used by ClojureScript, as an ES module.

// Natively for string arguments, about twice as fast; others are coerced as
// goog.string's do.
export function startsWith(str, prefix) {
  return typeof prefix === 'string' ? str.startsWith(prefix) : str.lastIndexOf(prefix, 0) == 0;
}

export function endsWith(str, suffix) {
  if (typeof suffix === 'string') return str.endsWith(suffix);
  const l = str.length - suffix.length;
  return l >= 0 && str.indexOf(suffix, l) == l;
}

export function isEmptyOrWhitespace(str) {
  return /^[\s\xa0]*$/.test(str);
}

export const isEmpty = isEmptyOrWhitespace;

export function isEmptyString(str) {
  return str.length == 0;
}

export function isNumeric(str) {
  return !/[^0-9]/.test(str);
}

export function isUnicodeChar(ch) {
  return ch.length == 1 && ch >= ' ' && ch <= '~' ||
      ch >= '\u0080' && ch <= '\uFFFD';
}

export function contains(str, subString) {
  return str.indexOf(subString) != -1;
}

export function trim(str) {
  return str.trim();
}

export function trimLeft(str) {
  return str.replace(/^[\s\xa0]+/, '');
}

export function trimRight(str) {
  return str.replace(/[\s\xa0]+$/, '');
}

export function capitalize(str) {
  return String(str.charAt(0)).toUpperCase() + String(str.slice(1)).toLowerCase();
}

export function regExpEscape(s) {
  return String(s)
      .replace(/([-()\[\]{}+?*.$\^|,:#<!\\])/g, '\\$1')
      .replace(/\x08/g, '\\x08');
}

export function makeSafe(obj) {
  return obj == null ? '' : String(obj);
}

export function hashCode(str) {
  let result = 0;
  for (let i = 0; i < str.length; ++i) {
    result = (31 * result + str.charCodeAt(i)) >>> 0;
  }
  return result;
}

export class StringBuffer {
  constructor(opt_a1, var_args) {
    this.buffer_ = '';
    if (opt_a1 != null) {
      this.append.apply(this, arguments);
    }
  }

  set(s) {
    this.buffer_ = '' + s;
  }

  append(a1, opt_a2, var_args) {
    this.buffer_ += String(a1);
    if (opt_a2 != null) {
      for (let i = 1; i < arguments.length; i++) {
        this.buffer_ += arguments[i];
      }
    }
    return this;
  }

  clear() {
    this.buffer_ = '';
  }

  getLength() {
    return this.buffer_.length;
  }

  toString() {
    return this.buffer_;
  }
}

export function repeat(string, length) {
  return new Array(length + 1).join(string);
}

// goog.string.format

const formatDemuxes = {};

export function format(formatString, var_args) {
  const args = Array.prototype.slice.call(arguments);
  const template = args.shift();
  if (typeof template == 'undefined') {
    throw new Error('[goog.string.format] Template required');
  }
  const formatRe = /%([0\-\ \+]*)(\d+)?(\.(\d+))?([%sfdiu])/g;
  function replacerDemuxer(
      match, flags, width, dotp, precision, type, offset, wholeString) {
    if (type == '%') {
      return '%';
    }
    const value = args.shift();
    if (typeof value == 'undefined') {
      throw new Error('[goog.string.format] Not enough arguments');
    }
    arguments[0] = value;
    return formatDemuxes[type].apply(null, arguments);
  }
  return template.replace(formatRe, replacerDemuxer);
}

formatDemuxes['s'] = function(
    value, flags, width, dotp, precision, type, offset, wholeString) {
  let replacement = value;
  if (isNaN(width) || width == '' || replacement.length >= Number(width)) {
    return replacement;
  }
  if (flags.indexOf('-', 0) > -1) {
    replacement = replacement + repeat(' ', Number(width) - replacement.length);
  } else {
    replacement = repeat(' ', Number(width) - replacement.length) + replacement;
  }
  return replacement;
};

formatDemuxes['f'] = function(
    value, flags, width, dotp, precision, type, offset, wholeString) {
  let replacement = value.toString();
  if (!(isNaN(precision) || precision == '')) {
    replacement = parseFloat(value).toFixed(precision);
  }
  let sign;
  if (Number(value) < 0) {
    sign = '-';
  } else if (flags.indexOf('+') >= 0) {
    sign = '+';
  } else if (flags.indexOf(' ') >= 0) {
    sign = ' ';
  } else {
    sign = '';
  }
  if (Number(value) >= 0) {
    replacement = sign + replacement;
  }
  if (isNaN(width) || replacement.length >= Number(width)) {
    return replacement;
  }
  replacement = isNaN(precision) ? Math.abs(Number(value)).toString() :
                                   Math.abs(Number(value)).toFixed(precision);
  const padCount = Number(width) - replacement.length - sign.length;
  if (flags.indexOf('-', 0) >= 0) {
    replacement = sign + replacement + repeat(' ', padCount);
  } else {
    const paddingChar = (flags.indexOf('0', 0) >= 0) ? '0' : ' ';
    replacement = sign + repeat(paddingChar, padCount) + replacement;
  }
  return replacement;
};

formatDemuxes['d'] = function(
    value, flags, width, dotp, precision, type, offset, wholeString) {
  return formatDemuxes['f'](
      parseInt(value, 10), flags, width, dotp, 0, type, offset, wholeString);
};

formatDemuxes['i'] = formatDemuxes['d'];
formatDemuxes['u'] = formatDemuxes['d'];

export function padNumber(num, length, opt_precision) {
  if (!Number.isFinite(num)) return String(num);
  let s = opt_precision !== undefined ? num.toFixed(opt_precision) : String(num);
  let index = s.indexOf('.');
  if (index === -1) index = s.length;
  const sign = s[0] === '-' ? '-' : '';
  if (sign) s = s.substring(1);
  return sign + repeat('0', Math.max(0, length - index)) + s;
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\x00': '&#0;' };

export function htmlEscape(str, opt_isLikelyToContainHtmlChars) {
  // unchanged without anything to escape, as Closure Library's (nil stays nil)
  if (!/[&<>"'\x00]/.test(str)) return str;
  return String(str).replace(/[&<>"'\x00]/g, (c) => HTML_ESCAPES[c]);
}

// no prototype: unknown entities (&constructor;) stay as they are
const XML_ENTITIES = { __proto__: null, amp: '&', lt: '<', gt: '>', quot: '"' };

function unescapeNumericEntity(entity) {
  if (entity.charAt(0) == '#') {
    // 0 prefixed: hex entities (&#x10) parse as hex numbers
    const n = Number('0' + entity.slice(1));
    if (!isNaN(n)) return String.fromCharCode(n);
  }
}

// Named HTML entities (&nbsp;) are decoded by the DOM where there's one, as
// Closure Library does, XML's and numeric ones otherwise
export function unescapeEntities(str) {
  if (!str.includes('&')) return str;
  const document = globalThis.document;
  if (document) {
    const seen = { __proto__: null, '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };
    let textarea;
    return str.replace(/&([^;\s<&]+);?/g, (s, entity) => {
      let value = seen[s] || unescapeNumericEntity(entity);
      if (!value) {
        // a textarea's content is text: no markup is parsed or run
        textarea = textarea || document.createElement('textarea');
        textarea.innerHTML = s;
        value = textarea.value;
      }
      return (seen[s] = value);
    });
  }
  return str.replace(/&([^;]+);/g, (s, entity) =>
    XML_ENTITIES[entity] || unescapeNumericEntity(entity) || s);
}
