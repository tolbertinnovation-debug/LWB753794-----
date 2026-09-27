'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../../src/main/calc');

const v = (s) => evaluate(s)?.value;
const t = (s) => evaluate(s)?.text;

test('basic arithmetic and precedence', () => {
  assert.equal(v('2+2'), 4);
  assert.equal(v('2+2*3'), 8);
  assert.equal(v('(2+2)*3'), 12);
  assert.equal(v('10/4'), 2.5);
  assert.equal(v('2^10'), 1024);
  assert.equal(v('2**3'), 8);
  assert.equal(v('2^3^2'), 512); // right associative
  assert.equal(v('-3+5'), 2);
  assert.equal(v('= 7*6'), 42);
  assert.equal(v('3 × 4 ÷ 2'), 6);
});

test('functions, constants, factorial, percent', () => {
  assert.equal(v('sqrt(16)'), 4);
  assert.equal(v('abs(-5)+1'), 6);
  assert.ok(Math.abs(v('2*pi') - 2 * Math.PI) < 1e-12);
  assert.equal(v('3(4+1)'), 15);
  assert.equal(v('5!'), 120);
  assert.equal(v('15% of 80'), 12);
  assert.equal(v('50%'), 0.5);
  assert.equal(v('10 % 3'), 1);
  assert.equal(v('1e3+1'), 1001);
});

test('formatting', () => {
  assert.equal(t('1000*1000'), '1,000,000');
  assert.equal(t('1/3'), '0.3333333333');
  assert.equal(t('1/0'), '∞');
});

test('non-math input is ignored', () => {
  assert.equal(evaluate('hello'), null);
  assert.equal(evaluate('42'), null);
  assert.equal(evaluate('-5'), null);
  assert.equal(evaluate('google.com'), null);
  assert.equal(evaluate('2024-01-05'), null);
  assert.equal(evaluate('alert(1)+1'), null);
  assert.equal(evaluate('2+'), null);
  assert.equal(evaluate('(2+3'), null);
  assert.equal(evaluate(''), null);
});
