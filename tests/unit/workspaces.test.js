'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Workspaces, safeTabs } = require('../../src/main/workspaces');
test('workspace URLs exclude privileged schemes, malformed links and embedded passwords', () => {
  const input = ['https://example.com/','file:///tmp/data','lib://settings/','javascript:alert(1)','https://user:secret@example.com/','garbage'].map(url => ({ url }));
  assert.deepEqual(safeTabs(input).map(t => t.url), ['https://example.com/']);
  assert.equal(safeTabs(Array(110).fill({ url: 'https://example.com/' })).length, 100);
});
test('workspaces persist, rename, delete and reject empty saves', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-workspaces-'));
  try {
    const file = path.join(dir, 'workspaces.json'); const w = new Workspaces(file);
    assert.throws(() => w.save('Empty', []));
    const item = w.save('Research', [{ url: 'https://example.com/a', title: 'Page', pinned: true }]);
    assert.equal(w.rename(item.id, 'Studies'), true); w.flush();
    const reopened = new Workspaces(file);
    assert.equal(reopened.get(item.id).name, 'Studies');
    assert.equal(reopened.get(item.id).tabs[0].pinned, true);
    assert.equal(reopened.remove(item.id), true); reopened.flush();
    assert.equal(new Workspaces(file).list().length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
