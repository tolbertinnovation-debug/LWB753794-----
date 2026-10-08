'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function harness(isPrivate) {
  const ctx = { sitePrefs: { getPermission: (_o, k) => k === 'camera' ? 'allow' : undefined, setPermission() { throw Error('Private permission persisted'); } } };
  const tab = { win: { showPermissionPrompt() {}, hidePermissionPrompt() {} } };
  const wc = { getURL: () => 'https://example.com' };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/main/permissions.js'), 'utf8'), { module: mod, exports: mod.exports, console, setTimeout, URL, process, require: name => {
    if (name === 'electron') return {};
    if (name === './context') return ctx;
    if (name === './windows') return { findTabByWebContents: () => tab };
    return require('../../src/main/' + name.slice(2));
  } });
  const manager = new mod.exports.PermissionManager();
  const ses = { setPermissionRequestHandler(fn) { this.request = fn; }, setPermissionCheckHandler(fn) { this.check = fn; }, setDisplayMediaRequestHandler() {} };
  manager.attach(ses, { isPrivate });
  return { manager, ses, wc };
}
test('media checks require all requested grants and insecure requests are denied', () => {
  const { ses, wc } = harness(false);
  assert.equal(ses.check(wc, 'media', 'https://example.com', {}), false);
  assert.equal(ses.check(wc, 'media', 'https://example.com', { mediaTypes: ['video'] }), true);
  let result; ses.request(wc, 'geolocation', r => result = r, { requestingUrl: 'http://example.com' });
  assert.equal(result, false);
});
test('private requests ignore persisted grants and hardware access is never auto-approved', () => {
  const { manager, ses, wc } = harness(true);
  assert.equal(ses.check(wc, 'camera', 'https://example.com', {}), false);
  let result;
  ses.request(wc, 'camera', r => result = r, { requestingUrl: 'https://example.com' });
  assert.equal(result, undefined);
  manager.respond([...manager.pending.keys()][0], true, true);
  assert.equal(result, true);
  result = undefined;
  ses.request(wc, 'fileSystem', r => result = r, { requestingUrl: 'https://example.com' });
  assert.equal(result, undefined);
  manager.cancelForTab([...manager.pending.values()][0].tab);
  assert.equal(result, false);
});
