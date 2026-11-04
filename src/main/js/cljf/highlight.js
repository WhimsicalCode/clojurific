// Syntax highlighting for cljf repl: the line being edited, as readline
// redraws it, and the values printed.

// ANSI colours, the terminal's own palette
const COLORS = {
  string: '32', // green
  regex: '32',
  comment: '90', // grey
  keyword: '36', // cyan
  number: '35', // magenta
  character: '35',
  constant: '35', // nil, true, false
  special: '34', // special forms and core macros, in call position
  unmatched: '31', // a closing bracket nothing opened
};

const SPECIAL = new Set(`
  def if do let let* quote var fn fn* loop loop* recur throw try catch finally new set! . js* letfn letfn*
  case* defn defn- defmacro defmulti defmethod defprotocol defrecord deftype defonce definterface defclass ns
  when when-not when-let when-first when-some if-not if-let if-some cond condp case and or not
  doseq dotimes for while doto -> ->> some-> some->> cond-> cond->> as-> binding with-redefs
  extend-type extend-protocol reify specify specify! comment declare in-ns require import
`.trim().split(/\s+/));

const DELIMITER = /[\s,()[\]{}"';`~@^\\]/;
const OPEN = '([{';
const CLOSE = ')]}';

/**
 * The tokens of code, {type, start, end}, without whitespace and plain
 * symbols: a string, regex or comment left open runs to the end.
 */
export function tokenize(code) {
  const tokens = [];
  const add = (type, start, end) => tokens.push({ type, start, end });
  const symbolEnd = i => {
    while (i < code.length && !DELIMITER.test(code[i])) i++;
    return i;
  };
  const stringEnd = i => {
    for (; i < code.length && code[i] !== '"'; i++) if (code[i] === '\\') i++;
    return Math.min(i + 1, code.length);
  };
  let depth = 0;
  // whether the last token opened a list, the symbol after it in call position
  let call = false;
  for (let i = 0; i < code.length;) {
    const c = code[i];
    const wasCall = call;
    call = false;
    if (/[\s,]/.test(c)) {
      call = wasCall;
      i++;
    } else if (c === ';' || (c === '#' && code[i + 1] === '!')) {
      const end = code.indexOf('\n', i);
      add('comment', i, end < 0 ? code.length : end);
      i = end < 0 ? code.length : end;
    } else if (c === '"') {
      const end = stringEnd(i + 1);
      add('string', i, end);
      i = end;
    } else if (c === '#' && code[i + 1] === '"') {
      const end = stringEnd(i + 2);
      add('regex', i, end);
      i = end;
    } else if (c === '\\') {
      // \a, \( , \newline, \u00e9: a character after the backslash, and the
      // rest of a name
      const end = i + 1 < code.length ? Math.max(i + 2, symbolEnd(i + 2)) : i + 1;
      add('character', i, end);
      i = end;
    } else if (OPEN.includes(c)) {
      depth++;
      call = c === '(';
      i++;
    } else if (CLOSE.includes(c)) {
      if (depth > 0) depth--;
      else add('unmatched', i, i + 1);
      i++;
    } else if (c === ':') {
      const end = Math.max(i + 1, symbolEnd(i + 1));
      add('keyword', i, end);
      i = end;
    } else if (/[0-9]/.test(c) || (/[+-]/.test(c) && /[0-9]/.test(code[i + 1] ?? ''))) {
      const end = symbolEnd(i + 1);
      add('number', i, end);
      i = end;
    } else if (c === '#' && code[i + 1] === '#') {
      // ##Inf, ##-Inf, ##NaN
      const end = symbolEnd(i + 2);
      add('number', i, end);
      i = end;
    } else if (c === '#' && code[i + 1] === '(') {
      // #(...), its symbol in call position too
      depth++;
      call = true;
      i += 2;
    } else if ("#'`~@^".includes(c)) {
      i++;
    } else {
      const end = symbolEnd(i);
      const symbol = code.slice(i, end);
      if (symbol === 'nil' || symbol === 'true' || symbol === 'false') add('constant', i, end);
      else if (wasCall && SPECIAL.has(symbol)) add('special', i, end);
      i = end;
    }
  }
  return tokens;
}

/**
 * code from index from on, highlighted with ANSI colours, the code before it
 * read as context (a string or comment it leaves open, the brackets it opens).
 */
export function highlight(code, from = 0) {
  let out = '';
  let at = from;
  for (const { type, start, end } of tokenize(code)) {
    if (end <= from) continue;
    const s = Math.max(start, from);
    out += `${code.slice(at, s)}\x1b[${COLORS[type]}m${code.slice(s, end)}\x1b[39m`;
    at = end;
  }
  return out + code.slice(at);
}

// Longer lines are left plain: readline redraws the whole line on each key
const MAX_LINE = 2000;

/**
 * Highlights the line readline interface rl edits, after context(), the
 * lines of the form read so far. It wraps readline's internals, which
 * redraw the line as prompt + line: on Node.js versions without them, the
 * line stays plain. Returns whether it could.
 */
export function highlightInput(rl, context = () => '') {
  if (typeof rl._writeToOutput !== 'function' || typeof rl._refreshLine !== 'function'
      || typeof rl._insertString !== 'function') {
    return false;
  }
  const write = rl._writeToOutput.bind(rl);
  const insert = rl._insertString.bind(rl);
  let inserting = null;
  let skipped = false;
  rl._writeToOutput = s => {
    // the text typed, which the line redrawn replaces
    if (inserting !== null && s === inserting) {
      skipped = true;
      return;
    }
    const prompt = rl.getPrompt();
    if (rl.line && rl.line.length <= MAX_LINE && s === prompt + rl.line) {
      const before = context();
      write(prompt + highlight(before + rl.line, before.length));
    } else {
      write(s);
    }
  };
  // readline writes the text typed at the end of the line as is, without
  // redrawing it: the line is redrawn highlighted instead
  rl._insertString = c => {
    if (rl.line.length + c.length > MAX_LINE) return insert(c);
    inserting = c;
    skipped = false;
    try {
      insert(c);
    } finally {
      inserting = null;
    }
    if (skipped) rl._refreshLine();
  };
  return true;
}
