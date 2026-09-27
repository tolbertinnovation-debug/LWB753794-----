'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveInput, displayUrl, extractSearchQuery, guessUrl } = require('../../src/main/url-utils');

const r = (text, opts) => resolveInput(text, opts);

test('plain domains become https URLs', () => {
  assert.equal(r('example.com').url, 'https://example.com');
  assert.equal(r('github.com/electron/electron').url, 'https://github.com/electron/electron');
  assert.equal(r('news.ycombinator.com').url, 'https://news.ycombinator.com');
  assert.equal(r('  wikipedia.org  ').url, 'https://wikipedia.org');
  assert.equal(r('例え.jp').url, 'https://例え.jp');
});

test('local hosts and IPs use http', () => {
  assert.equal(r('localhost:3000').url, 'http://localhost:3000');
  assert.equal(r('localhost').url, 'http://localhost');
  assert.equal(r('192.168.1.1').url, 'http://192.168.1.1');
  assert.equal(r('127.0.0.1:8080/api').url, 'http://127.0.0.1:8080/api');
  assert.equal(r('[::1]:8080').url, 'http://[::1]:8080');
  assert.equal(r('printer.local').url, 'http://printer.local');
  assert.equal(r('intranet:8080').url, 'http://intranet:8080');
});

test('explicit schemes are kept', () => {
  assert.equal(r('http://example.com').url, 'http://example.com');
  assert.equal(r('https://a.b/c?d=e#f').url, 'https://a.b/c?d=e#f');
  assert.equal(r('file:///tmp/x.html').url, 'file:///tmp/x.html');
  assert.equal(r('about:blank').url, 'about:blank');
  assert.equal(r('http:example.com').url, 'http://example.com');
  assert.equal(r('javascript:alert(1)'), null);
});

test('text becomes a search with the chosen engine', () => {
  assert.equal(r('hello world').url, 'https://www.google.com/search?q=hello+world');
  assert.equal(r('hello world', { searchEngine: 'duckduckgo' }).url, 'https://duckduckgo.com/?q=hello+world');
  assert.equal(r('what is 3.14').type, 'search');
  assert.equal(r('electron').type, 'search');
  assert.equal(r('hello.qqqq').type, 'search');
  assert.equal(r('hello.world').type, 'url'); // .world is a real TLD
  assert.equal(r('3.14').type, 'search');
  assert.equal(r('?example.com').type, 'search');
  assert.equal(r('c++ & rust').url, 'https://www.google.com/search?q=c%2B%2B+%26+rust');
});

test('custom search engine', () => {
  const res = r('cats', { searchEngine: 'custom', customSearchUrl: 'https://s.example/?q=%s' });
  assert.equal(res.url, 'https://s.example/?q=cats');
});

test('keywords and bangs', () => {
  assert.equal(r('yt lofi beats').url, 'https://www.youtube.com/results?search_query=lofi+beats');
  assert.equal(r('!w Ada Lovelace').url, 'https://en.wikipedia.org/wiki/Special:Search?search=Ada+Lovelace');
  assert.equal(r('cats !yt').url, 'https://www.youtube.com/results?search_query=cats');
  assert.equal(r('cats !w').engine, 'Wikipedia');
  // Short common words are bang-only so sentences still search normally.
  assert.equal(r('a good movie').type, 'search');
  assert.equal(r('so what now').type, 'search');
  assert.equal(r('!a headphones').engine, 'Amazon');
});

test('internal pages and foreign aliases', () => {
  assert.equal(r('lib://settings').url, 'lib://settings');
  assert.equal(r('lib:history').url, 'lib://history');
  assert.equal(r('chrome://settings').url, 'lib://settings');
  assert.equal(r('edge://downloads').url, 'lib://downloads');
  assert.equal(r('chrome://version').url, 'lib://about');
});

test('file paths', () => {
  assert.equal(r('/home/user/file.html').url, 'file:///home/user/file.html');
  assert.equal(r('C:\\Users\\me\\a.html').url, 'file:///C:/Users/me/a.html');
});

test('guessUrl rejects sentences', () => {
  assert.equal(guessUrl('not a url'), null);
  assert.equal(guessUrl('foo:bar'), null);
});

test('displayUrl', () => {
  assert.equal(displayUrl('https://example.com/'), 'https://example.com');
  assert.equal(displayUrl('https://example.com/a%20b'), 'https://example.com/a b');
  assert.equal(displayUrl('lib://newtab/'), '');
  assert.equal(displayUrl('lib://settings/'), 'lib://settings/');
});

test('extractSearchQuery', () => {
  assert.equal(extractSearchQuery('https://www.google.com/search?q=hello+world&x=1'), 'hello world');
  assert.equal(extractSearchQuery('https://duckduckgo.com/?q=cats', { searchEngine: 'duckduckgo' }), 'cats');
  assert.equal(extractSearchQuery('https://example.com/?q=x'), null);
});
