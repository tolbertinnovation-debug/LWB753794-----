'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const saver = require('../../src/main/data-saver');
const settings = (mode, allowlist = []) => ({ get: key => key === 'dataSaverMode' ? mode : allowlist });
const request = type => ({ resourceType: type, url: 'https://cdn.example.com/asset' });
test('data saver stays disabled even with legacy enabled modes', () => {
  for (const mode of ['off', 'balanced', 'maximum']) {
    for (const url of ['https://youtube.com/', 'https://example.com/', 'lib://newtab/']) {
      assert.equal(saver.activeFor(settings(mode), url), false);
      for (const type of ['mainFrame', 'subFrame', 'script', 'stylesheet', 'xhr', 'media', 'image', 'font', 'webSocket', 'other']) {
        assert.equal(saver.shouldBlock(settings(mode), request(type), url), false);
      }
    }
  }
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
