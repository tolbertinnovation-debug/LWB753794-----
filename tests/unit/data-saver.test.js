'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const saver = require('../../src/main/data-saver');
const settings = (mode, allowlist = []) => ({ get: key => key === 'dataSaverMode' ? mode : allowlist });
const request = type => ({ resourceType: type, url: 'https://cdn.example.com/asset' });
test('data saver blocks only selected heavy resource types and keeps essential page traffic', () => {
  for (const mode of ['off', 'balanced', 'maximum']) {
    for (const type of ['mainFrame', 'subFrame', 'script', 'stylesheet', 'xhr', 'webSocket', 'other']) assert.equal(saver.shouldBlock(settings(mode), request(type), 'https://example.com/'), false);
  }
  assert.equal(saver.shouldBlock(settings('balanced'), request('media'), 'https://example.com/'), true);
  assert.equal(saver.shouldBlock(settings('balanced'), request('image'), 'https://example.com/'), false);
  for (const type of ['media', 'image', 'font']) assert.equal(saver.shouldBlock(settings('maximum'), request(type), 'https://example.com/'), true);
  assert.equal(saver.shouldBlock(settings('off'), request('media'), 'https://example.com/'), false);
});
test('site exceptions apply to the top-level hostname and do not bleed into unrelated hosts', () => {
  const s = settings('maximum', ['example.com']);
  assert.equal(saver.shouldBlock(s, request('image'), 'https://example.com/lesson'), false);
  assert.equal(saver.shouldBlock(s, request('image'), 'https://other.com/'), true);
  assert.equal(saver.activeFor(s, 'https://example.com.evil.com'), true);
  assert.equal(saver.activeFor(s, 'lib://newtab/'), false);
  assert.equal(saver.activeFor(s, 'file:///tmp/page.html'), false);
});
test('statistics stay isolated by browsing session and reset with private browsing cleanup', () => {
  const regular = {}, privateSession = {};
  saver.countBlocked(regular, 'media'); saver.countBlocked(privateSession, 'image');
  assert.equal(saver.sessionStats(regular).image, 0);
  assert.equal(saver.sessionStats(privateSession).media, 0);
  const copy = saver.sessionStats(regular); copy.total = 100;
  assert.equal(saver.sessionStats(regular).total, 1);
  saver.resetStats(privateSession); assert.equal(saver.sessionStats(privateSession).total, 0);
});
