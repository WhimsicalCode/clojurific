// Copyright The Closure Library Authors. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// goog.date.duration as an ES module, from the Closure Library sources, in
// the en locale, goog.LOCALE's default: the Closure Library loaded every
// locale's number and date symbols for its messages.

const MINUTE_MS = 60000;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

const part = (count, unit) => (count == 0 ? '' : count + ' ' + unit + (count == 1 ? '' : 's'));

// "1 day 2 hours 3 minutes", parts that are 0 left out, "0 minutes" under a
// minute
export function format(durationMs) {
  let ms = Math.abs(durationMs);
  if (ms < MINUTE_MS) return '0 minutes';
  const days = Math.floor(ms / DAY_MS);
  ms %= DAY_MS;
  const hours = Math.floor(ms / HOUR_MS);
  ms %= HOUR_MS;
  const minutes = Math.floor(ms / MINUTE_MS);
  const daysSeparator = days * (hours + minutes) ? ' ' : '';
  const hoursSeparator = hours * minutes ? ' ' : '';
  return part(days, 'day') + daysSeparator + part(hours, 'hour') + hoursSeparator + part(minutes, 'minute');
}
