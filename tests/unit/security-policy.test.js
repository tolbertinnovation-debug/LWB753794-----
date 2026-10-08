'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { apiMethod, trustedInternalFrame, securePermissionOrigin, safeExternalLink } = require('../../src/main/security-policy');
test('privileged dispatch rejects inherited methods and untrusted internal frames', () => {
  const api = { allowed() {} };
  assert.equal(apiMethod(api, 'allowed'), api.allowed);
  for (const key of ['constructor', '__proto__', 'toString', 'missing', null]) assert.equal(apiMethod(api, key), null);
  assert.equal(trustedInternalFrame({ url: 'lib://settings/', parent: null }), true);
  for (const url of ['https://settings/','lib://evil/','lib://user@settings/','lib://settings:3/','lib://net-error/']) assert.equal(trustedInternalFrame({ url }), false);
  assert.equal(trustedInternalFrame({ url: 'lib://settings/', parent: {} }), false);
});
test('sensitive permissions need secure origins; external links use a narrow protocol allowlist', () => {
  for (const url of ['https://example.com','http://localhost:3000','http://127.0.0.1','http://[::1]']) assert.equal(securePermissionOrigin(url), true);
  for (const url of ['http://example.com','file:///tmp/a','data:text/html,x','https://user:secret@example.com','http://localhost.evil.com']) assert.equal(securePermissionOrigin(url), false);
  assert.equal(safeExternalLink('mailto:hello@example.com'), true);
  assert.equal(safeExternalLink('tel:+23112345678'), true);
  for (const url of ['file:///tmp/a','javascript:alert(1)','powershell:run','ms-msdt:exploit','https://example.com','mailto:a@example.com\nfoo']) assert.equal(safeExternalLink(url), false);
});

test('settings reject prototype keys and new profiles default to stronger network privacy', () => {
  const { Settings, defaults } = require('../../src/main/settings');
  const d = defaults();
  assert.equal(d.httpsOnly, true);
  assert.equal(d.blockThirdPartyCookies, true);
  assert.equal(d.searchSuggestions, false);
  const settings = Object.create(Settings.prototype);
  settings._defaults = d;
  for (const key of ['__proto__', 'constructor', 'toString']) assert.equal(settings.set(key, {}), false);
});
