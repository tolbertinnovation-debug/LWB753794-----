'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../../src/main/store');
const { History } = require('../../src/main/history');
const { Bookmarks } = require('../../src/main/bookmarks');
const { Settings } = require('../../src/main/settings');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lib-test-'));
}

test('JsonStore persists atomically and recovers from corruption', () => {
  const dir = tmpdir();
  const file = path.join(dir, 's.json');
  const s = new JsonStore(file, () => ({ n: 0 }));
  s.data.n = 5;
  s.save();
  s.flush();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 5);
  fs.writeFileSync(file, '{not json');
  const s2 = new JsonStore(file, () => ({ n: 1 }));
  assert.equal(s2.data.n, 1);
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('.corrupt-')));
});

test('Settings validate values and emit changes', () => {
  const dir = tmpdir();
  const s = new Settings(path.join(dir, 'settings.json'), '/tmp/dl');
  const events = [];
  s.on('change', (k, v) => events.push([k, v]));
  assert.equal(s.get('theme'), 'system');
  assert.equal(s.set('theme', 'dark'), true);
  assert.equal(s.set('theme', 'purple'), false);
  assert.equal(s.set('nope', 1), false);
  assert.equal(s.set('accentColor', 'red'), false);
  assert.equal(s.set('accentColor', '#112233'), true);
  assert.equal(s.set('adblockEnabled', 'yes'), false);
  assert.equal(s.get('downloadDir'), '/tmp/dl');
  assert.deepEqual(events, [['theme', 'dark'], ['accentColor', '#112233']]);
  s.flush();
  const s2 = new Settings(path.join(dir, 'settings.json'), '/tmp/dl');
  assert.equal(s2.get('theme'), 'dark');
});

test('History records, ranks, completes and clears', () => {
  const h = new History(path.join(tmpdir(), 'history.json'));
  h.addVisit({ url: 'https://github.com/', title: 'GitHub', typed: true });
  h.addVisit({ url: 'https://github.com/electron/electron', title: 'Electron' });
  h.addVisit({ url: 'https://gitlab.com/', title: 'GitLab' });
  h.addVisit({ url: 'lib://settings', title: 'nope' });
  h.addVisit({ url: 'https://example.com/page', title: 'Example Page' });
  assert.equal(h.searchUrls('git')[0].url, 'https://github.com/');
  assert.equal(h.inlineCompletion('git'), 'github.com');
  assert.equal(h.inlineCompletion('github.com/el'), 'github.com/electron/electron');
  assert.equal(h.inlineCompletion('zzz'), null);
  assert.equal(h.query({ text: 'example' }).length, 1);
  assert.equal(h.query().length, 4);
  const top = h.topSites(8);
  assert.equal(top.filter((t) => t.host === 'github.com').length, 1);
  assert.ok(top.every((t) => !t.url.startsWith('lib:')));
  h.deleteUrl('https://gitlab.com/');
  assert.equal(h.searchUrls('gitlab').length, 0);
  const since = Date.now() - 1000;
  h.clear(since);
  assert.equal(h.query().length, 0);
});

test('History fills in titles for repeat visits', () => {
  const h = new History(path.join(tmpdir(), 'history.json'));
  h.addVisit({ url: 'https://a.com/', title: '' });
  h.updatePage('https://a.com/', { title: 'A' });
  h.addVisit({ url: 'https://b.com/', title: 'B' });
  h.addVisit({ url: 'https://a.com/', title: '' });
  assert.equal(h.query()[0].title, 'A', 'known title reused');
  h.updatePage('https://a.com/', { title: 'A!' });
  assert.equal(h.query()[0].title, 'A!');
  assert.equal(h.query()[2].title, 'A', 'older visit keeps its title');
});

test('History collapses rapid duplicate visits', () => {
  const h = new History(path.join(tmpdir(), 'history.json'));
  h.addVisit({ url: 'https://a.com/', title: 'A' });
  h.addVisit({ url: 'https://a.com/', title: 'A2' });
  assert.equal(h.query().length, 1);
  assert.equal(h.query()[0].title, 'A2');
});

test('Bookmarks add, move, remove, search, export/import', () => {
  const dir = tmpdir();
  const b = new Bookmarks(path.join(dir, 'bookmarks.json'));
  const one = b.add({ parentId: 'bar', title: 'One', url: 'https://one.com/' });
  const folder = b.add({ parentId: 'bar', type: 'folder', title: 'Stuff' });
  const two = b.add({ parentId: folder.id, title: 'Two & <Co>', url: 'https://two.com/?a=1&b=2' });
  assert.ok(b.isBookmarked('https://one.com/'));
  assert.equal(b.search('two')[0].id, two.id);
  assert.equal(b.move(folder.id, folder.id), false, 'cannot move folder into itself');
  assert.ok(b.move(one.id, folder.id, 0));
  assert.equal(b.get(folder.id).children[0].id, one.id);
  const html = b.exportHtml();
  assert.match(html, /Two &amp; &lt;Co&gt;/);
  assert.match(html, /PERSONAL_TOOLBAR_FOLDER/);

  const b2 = new Bookmarks(path.join(dir, 'bookmarks2.json'));
  const n = b2.importHtml(html);
  assert.equal(n, 2);
  assert.ok(b2.isBookmarked('https://two.com/?a=1&b=2'));
  assert.equal(b2.findByUrl('https://two.com/?a=1&b=2').title, 'Two & <Co>');
  assert.ok(b2.barItems().some((c) => c.type === 'folder' && c.title === 'Stuff'));

  assert.ok(b.removeUrl('https://two.com/?a=1&b=2'));
  assert.equal(b.isBookmarked('https://two.com/?a=1&b=2'), false);
  assert.equal(b.remove('bar'), false, 'roots cannot be removed');
});

test('Bookmarks import handles Firefox-style exports', () => {
  const b = new Bookmarks(path.join(tmpdir(), 'bm.json'));
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks Toolbar</H3>
  <DL><p>
    <DT><A HREF="https://mozilla.org/" ADD_DATE="1600000000">Mozilla</A>
    <DT><A HREF="javascript:void(0)">Bad</A>
  </DL><p>
  <DT><H3>Menu</H3>
  <DL><p>
    <DT><A HREF="https://example.com/">Ex &amp; ample</A>
  </DL><p>
</DL><p>`;
  assert.equal(b.importHtml(html), 2);
  assert.ok(b.barItems().some((c) => c.url === 'https://mozilla.org/'));
  const imported = b.tree().other.children.find((c) => c.title === 'Imported');
  assert.equal(imported.children[0].title, 'Menu');
  assert.equal(imported.children[0].children[0].title, 'Ex & ample');
});
