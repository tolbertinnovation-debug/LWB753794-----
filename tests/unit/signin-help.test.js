'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rejectedGoogleSignin, signinWebsite } = require('../../src/main/signin-help');
test('Google rejection helper only accepts exact secure Google rejection routes', () => {
  assert.equal(rejectedGoogleSignin('https://accounts.google.com/v3/signin/rejected'), true);
  for (const url of ['https://accounts.google.com.evil.com/v3/signin/rejected', 'http://accounts.google.com/v3/signin/rejected', 'https://accounts.google.com/v3/signin/identifier', 'https://user@accounts.google.com/v3/signin/rejected']) assert.equal(rejectedGoogleSignin(url), false);
});
test('sign-in handoff strips OAuth parameters and rejects unsafe website URLs', () => {
  const base = 'https://accounts.google.com/v3/signin/rejected?app_domain=';
  assert.equal(signinWebsite(base + encodeURIComponent('https://codepen.io/login?token=secret#code')), 'https://codepen.io/');
  for (const value of ['javascript:alert(1)', 'http://codepen.io', 'https://user:pass@codepen.io', 'https://codepen.io:8443', 'invalid']) assert.equal(signinWebsite(base + encodeURIComponent(value)), null);
});
