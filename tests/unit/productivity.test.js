'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanLink, duplicateTabs, boundedHistory } = require('../../src/main/productivity');

test('clean links remove campaign identifiers and preserve routing, fragments and signed fields', () => {
  const url = new URL(cleanLink('https://example.com/read?id=7&utm_source=x&UTM_medium=y&fbclid=z&signature=keep#section'));
  assert.equal(url.search, '?id=7&signature=keep');
  assert.equal(url.hash, '#section');
  assert.equal(cleanLink('file:///tmp/book.html'), 'file:///tmp/book.html');
  assert.equal(cleanLink('not a url'), 'not a url');
});

test('duplicate cleanup protects active, pinned, playing and loading tabs and distinct URLs', () => {
  const make = (id, props = {}, url = 'https://example.com/') => ({ id, state: { url, ...props } });
  const active = make(1);
  const duplicate = make(2);
  const tabs = [duplicate, active, make(3, { pinned: true }), make(4, { audible: true }), make(5, { loading: true }), make(6, {}, 'https://example.com/#different'), make(7, {}, 'lib://newtab/')];
  assert.deepEqual(duplicateTabs(tabs, active), [duplicate]);
  const pinned = make(8, { pinned: true });
  assert.deepEqual(duplicateTabs([duplicate, pinned], null), [duplicate]);
});

test('sleep history preserves current page and valid position across long back/forward chains', () => {
  const entries = Array.from({ length: 120 }, (_, n) => ({ url: `https://example.com/${n}` }));
  for (const index of [0, 20, 49, 50, 90, 119]) {
    const saved = boundedHistory(entries, index);
    assert.equal(saved.entries.length, 50);
    assert.deepEqual(saved.entries[saved.index], entries[index]);
    assert.ok(saved.index >= 0 && saved.index < saved.entries.length);
  }
  assert.deepEqual(boundedHistory([], 0), { entries: [], index: -1 });
  assert.deepEqual(boundedHistory(entries.slice(0, 4), 2), { entries: entries.slice(0, 4), index: 2 });
});
