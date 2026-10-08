'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog } = require('electron');
const busy = new WeakSet();

async function guide(win) {
  await dialog.showMessageBox(win.win, {
    type: 'info', title: 'Website inspection tools',
    message: 'Inspect the code your browser receives',
    detail: 'Press F12 for Developer Tools.\n\nElements: inspect HTML, edit CSS, and check accessibility. Right-click a page element and choose Inspect.\nConsole: debug JavaScript and errors.\nSources: inspect delivered scripts and set breakpoints.\nNetwork: reload the page to inspect requests, headers, timing, and responses; export a HAR from the Network panel. HAR files may contain passwords, cookies, and tokens.\nApplication: inspect cookies, storage, and service workers.\nPerformance: record page activity and identify slow work.\nDevice toolbar: test responsive layouts.\n\nView page source shows delivered HTML. Private server code is not exposed. Only paste Console code you trust.\n\nDeveloper extensions supports compatible unpacked extensions, including DevTools panels. Chrome Web Store installation and all Chrome APIs are not supported.',
  });
}

async function manage(win) {
  if (!win || busy.has(win)) return;
  busy.add(win);
  try {
    if (win.isPrivate) {
      await dialog.showMessageBox(win.win, { type: 'info', message: 'Extensions are disabled in private windows.' });
      return;
    }
    const api = win.session.extensions;
    const loaded = api.getAllExtensions();
    const buttons = ['Load unpacked extension…', ...loaded.map(x => `Remove ${x.name}`), 'Close'];
    const { response } = await dialog.showMessageBox(win.win, {
      type: 'info', title: 'Developer extensions', message: `${loaded.length} loaded developer extension(s)`,
      detail: 'Load a trusted folder containing manifest.json. Compatible DevTools panels appear after reopening F12. Extensions can access websites according to their permissions. Local file access is disabled. Extensions remain loaded until removed or the browser exits; load them again after restarting. Keep the selected folder available. Not all Chrome extensions are compatible.',
      buttons, defaultId: buttons.length - 1, cancelId: buttons.length - 1,
    });
    if (response > 0 && response <= loaded.length) {
      api.removeExtension(loaded[response - 1].id);
      win.sendChrome('toast', { message: 'Extension removed. Reload pages and reopen Developer Tools.' });
      return;
    }
    if (response !== 0) return;
    const chosen = await dialog.showOpenDialog(win.win, { title: 'Select unpacked extension folder', properties: ['openDirectory'] });
    if (chosen.canceled || !chosen.filePaths.length) return;
    const folder = await fs.realpath(chosen.filePaths[0]);
    const file = path.join(folder, 'manifest.json');
    if ((await fs.stat(file)).size > 1024 * 1024) throw new Error('Manifest is too large.');
    const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || ![2, 3].includes(manifest.manifest_version)) throw new Error('Invalid extension manifest.');
    const permissions = [manifest.permissions, manifest.host_permissions, ...(manifest.content_scripts || []).map(x => x.matches)].flat(2).filter(x => typeof x === 'string');
    const approval = await dialog.showMessageBox(win.win, {
      type: 'warning', title: 'Review extension access', message: `Load ${manifest.name.slice(0, 200)} (${manifest.version.slice(0, 100)})?`,
      detail: `Folder: ${folder}\n\nRequested permissions and website matches:\n${permissions.join('\n').slice(0, 12000) || 'None declared'}\n\nOnly load extensions from a source you trust. These permissions are declared by the extension, not a security audit.`,
      buttons: ['Cancel', 'Load extension'], defaultId: 0, cancelId: 0,
    });
    if (approval.response !== 1) return;
    const extension = await api.loadExtension(folder, { allowFileAccess: false });
    win.sendChrome('toast', { message: `${extension.name} loaded. Reload the page and reopen F12.` });
  } catch (err) {
    if (!win.closed) await dialog.showMessageBox(win.win, { type: 'error', message: 'Could not load the extension', detail: String(err.message).slice(0, 2000) });
  } finally {
    busy.delete(win);
  }
}

module.exports = { manage, guide };
