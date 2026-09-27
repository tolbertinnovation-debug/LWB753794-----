'use strict';

/**
 * Safe arithmetic evaluator for the address bar ("2+2*3", "sqrt(16)^2",
 * "15% of 80", "2^10"). No eval — a small recursive-descent parser.
 *
 * Grammar:
 *   expr   := term (('+' | '-') term)*
 *   term   := factor (('*' | '/' | '%' | implicit) factor)*
 *   factor := unary ('^' factor)?
 *   unary  := ('-' | '+') unary | postfix
 *   postfix:= primary ('!')*
 *   primary:= number | const | func '(' expr ')' | '(' expr ')'
 */

const FUNCS = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

function tokenize(input) {
  const tokens = [];
  const s = input.replace(/×/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi').replace(/,/g, '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      // scientific notation: 1e5, 2.5e-3
      if (s[j] === 'e' && /[0-9+-]/.test(s[j + 1] || '') && !/[a-z]/i.test(s[j + 1] || '')) {
        let k = j + 1;
        if (s[k] === '+' || s[k] === '-') k++;
        if (/[0-9]/.test(s[k] || '')) {
          while (k < s.length && /[0-9]/.test(s[k])) k++;
          j = k;
        }
      }
      const text = s.slice(i, j);
      if ((text.match(/\./g) || []).length > 1) throw new Error('bad number');
      tokens.push({ type: 'num', value: Number(text) });
      i = j;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < s.length && /[a-z]/i.test(s[j])) j++;
      tokens.push({ type: 'id', value: s.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ('+-*/%^()!'.includes(c)) {
      if (c === '*' && s[i + 1] === '*') {
        tokens.push({ type: 'op', value: '^' });
        i += 2;
        continue;
      }
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }
    throw new Error(`unexpected ${c}`);
  }
  return tokens;
}

function factorial(n) {
  if (n < 0 || !Number.isInteger(n) || n > 170) return NaN;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const isOp = (v) => peek() && peek().type === 'op' && peek().value === v;

  function expr() {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = next().value;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  function term() {
    let v = factor();
    for (;;) {
      if (isOp('*')) {
        next();
        v *= factor();
      } else if (isOp('/')) {
        next();
        v /= factor();
      } else if (isOp('%')) {
        next();
        // "x % of y" and trailing "x%" handled here: "%" followed by "of"
        if (peek() && peek().type === 'id' && peek().value === 'of') {
          next();
          v = (v / 100) * factor();
        } else if (!peek() || (peek().type === 'op' && peek().value === ')')) {
          v = v / 100;
        } else if (peek().type === 'op' && ['+', '-', '*', '/'].includes(peek().value)) {
          v = v / 100;
        } else {
          v %= factor();
        }
      } else if (
        peek() &&
        (peek().type === 'num' || peek().type === 'id' || (peek().type === 'op' && peek().value === '('))
      ) {
        // implicit multiplication: 2pi, 3(4+5)
        if (peek().type === 'id' && peek().value === 'of') throw new Error('dangling of');
        v *= factor();
      } else {
        break;
      }
    }
    return v;
  }

  function factor() {
    const base = unary();
    if (isOp('^')) {
      next();
      return Math.pow(base, factor());
    }
    return base;
  }

  function unary() {
    if (isOp('-')) {
      next();
      return -unary();
    }
    if (isOp('+')) {
      next();
      return unary();
    }
    return postfix();
  }

  function postfix() {
    let v = primary();
    while (isOp('!')) {
      next();
      v = factorial(v);
    }
    return v;
  }

  function primary() {
    const t = next();
    if (!t) throw new Error('unexpected end');
    if (t.type === 'num') return t.value;
    if (t.type === 'id') {
      if (t.value in CONSTS) return CONSTS[t.value];
      if (t.value in FUNCS) {
        if (!isOp('(')) throw new Error('expected (');
        next();
        const v = expr();
        if (!isOp(')')) throw new Error('expected )');
        next();
        return FUNCS[t.value](v);
      }
      throw new Error(`unknown ${t.value}`);
    }
    if (t.type === 'op' && t.value === '(') {
      const v = expr();
      if (!isOp(')')) throw new Error('expected )');
      next();
      return v;
    }
    throw new Error('unexpected token');
  }

  const result = expr();
  if (pos !== tokens.length) throw new Error('trailing input');
  return result;
}

function formatNumber(n) {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return n.toLocaleString('en-US');
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-6 || abs >= 1e21)) return n.toExponential(8).replace(/\.?0+e/, 'e');
  return Number(n.toPrecision(12)).toLocaleString('en-US', { maximumFractionDigits: 10 });
}

/**
 * Evaluate `input` if it looks like a math expression.
 * @returns {{ value: number, text: string } | null}
 */
function evaluate(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/^=\s*/, '');
  if (!s || s.length > 200) return null;
  // Must contain at least one operator or function; a lone number isn't math.
  const hasOperator = /[+\-*/^%!×÷]/.test(s.replace(/^[+-]/, '')) || /\b(sqrt|cbrt|abs|round|floor|ceil|sin|cos|tan|asin|acos|atan|log|ln|exp)\s*\(/i.test(s);
  if (!hasOperator) return null;
  // Reject things that look like URLs, dates or phone numbers.
  if (/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(s)) return null;
  if (/[a-z]{2,}\.[a-z]{2,}/i.test(s)) return null;
  // Only allow identifiers we know about.
  const ids = s.toLowerCase().match(/[a-z]+/g) || [];
  if (ids.some((id) => !(id in FUNCS) && !(id in CONSTS) && id !== 'of')) return null;
  try {
    s = s.replace(/\s+/g, ' ');
    const value = parse(tokenize(s));
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    if (!Number.isFinite(value)) return { value, text: value > 0 ? '∞' : '-∞' };
    return { value, text: formatNumber(value) };
  } catch {
    return null;
  }
}

module.exports = { evaluate };
