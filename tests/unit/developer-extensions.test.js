'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness({ privateWindow = false, approve = true } = {}) {
  let calls = 0;
  const loads = [];
  const dialogs = [];
  const dialog = {
    async showMessageBox(parent, options) {
      dialogs.push(options);
      return { response: calls++ === 0 ? 0 : approve ? 1 : 0 };
    },
    async showOpenDialog() { return { filePaths: ['/trusted'], canceled: false }; },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/main/developer-extensions.js'), 'utf8'), {
    module, require: name => name === 'electron' ? { dialog } : name === 'node:fs/promises' ? {
      realpath: async p => p, stat: async () => ({ size: 100 }),
      readFile: async () => JSON.stringify({ name: 'Test tools', version: '1.0', manifest_version: 3, host_permissions: ['https://example.com/*'] }),
    } : require(name),
  });
  const win = { isPrivate: privateWindow, win: {}, sendChrome() {}, session: { extensions: {
    getAllExtensions: () => [], loadExtension: async (...args) => { loads.push(args); return { name: 'Test tools' }; },
  } } };
  return { manage: () => module.exports.manage(win), loads, dialogs };
}

test('extensions never load in private windows or after permission cancellation', async () => {
  for (const options of [{ privateWindow: true }, { approve: false }]) {
    const h = harness(options); await h.manage(); assert.equal(h.loads.length, 0);
  }
});
test('extension loading reviews host permissions and disables local file access', async () => {
  const h = harness(); await h.manage();
  assert.equal(h.loads.length, 1);
  assert.equal(h.loads[0][1].allowFileAccess, false);
  assert.match(h.dialogs[1].detail, /https:\/\/example.com\/\*/);
});
