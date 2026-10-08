'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Bookmarks } = require('../../src/main/bookmarks');

test('reading list deduplicates pages and retains folder identity after restart and rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-reading-'));
  const file = path.join(dir, 'bookmarks.json');
  try {
    const b = new Bookmarks(file);
    const first = b.saveForLater({ url: 'https://example.com/article', title: 'Article' });
    const folder = b.readingListFolder();
    assert.equal(b.saveForLater({ url: first.url, title: 'Again' }).id, first.id);
    b.update(folder.id, { title: 'My reading' });
    b.store.flush();
    const reopened = new Bookmarks(file);
    assert.equal(reopened.readingListFolder().id, folder.id);
    assert.equal(reopened.readingListFolder().children.length, 1);
    assert.throws(() => reopened.saveForLater({ url: 'javascript:alert(1)' }));
    reopened.remove(folder.id);
    assert.notEqual(reopened.readingListFolder().id, folder.id);
    reopened.store.flush();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
