'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, clipboard, dialog, shell, nativeTheme } = require('electron');
const ctx = require('./context');
const { NEWTAB_URL } = require('./tab');

const { cleanLink, duplicateTabs } = require('./productivity');

const IS_MAC = process.platform === 'darwin';

function windows() {
  return require('./windows');
}

function openInternal(win, page, { newTab = true } = {}) {
  const url = `lib://${page}/`;
  if (!win) win = windows().createWindow({ url });
  // Reuse an existing tab showing that page.
  const existing = win.tabs.find((t) => t.state.url.startsWith(url));
  if (existing) {
    win.activateTab(existing);
    return existing;
  }
  if (newTab && !(win.activeTab && win.activeTab.state.url === NEWTAB_URL)) return win.createTab({ url });
  win.activeTab?.navigate(url);
  return win.activeTab;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
}

async function screenshot(win, tab, fullPage) {
  const wc = tab?.webContents;
  if (!wc) return;
  let png;
  try {
    if (fullPage) {
      const dbg = wc.debugger;
      const attached = dbg.isAttached();
      if (!attached) dbg.attach('1.3');
      try {
        const res = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
        png = Buffer.from(res.data, 'base64');
      } finally {
        if (!attached) dbg.detach();
      }
    } else {
      png = (await wc.capturePage()).toPNG();
    }
  } catch (err) {
    win.sendChrome('toast', { message: 'Couldn’t capture this page', kind: 'error' });
    return;
  }
  const dir = ctx.settings.get('downloadDir') || app.getPath('downloads');
  const file = path.join(dir, `LIB Screenshot ${timestamp()}.png`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, png);
    const { nativeImage } = require('electron');
    clipboard.writeImage(nativeImage.createFromBuffer(png));
    win.sendChrome('toast', { message: 'Screenshot saved and copied', action: { label: 'Show', command: 'showFile', arg: file } });
  } catch (err) {
    win.sendChrome('toast', { message: 'Couldn’t save screenshot', kind: 'error' });
  }
}

async function savePage(win, tab) {
  const wc = tab?.webContents;
  if (!wc) return;
  const title = (tab.state.title || 'page').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const dir = ctx.settings.get('downloadDir') || app.getPath('downloads');
  const { canceled, filePath } = await dialog.showSaveDialog(win.win, {
    title: 'Save page as',
    defaultPath: path.join(dir, `${title}.html`),
    filters: [
      { name: 'Webpage, Complete', extensions: ['html', 'htm'] },
      { name: 'Webpage, HTML Only', extensions: ['html', 'htm'] },
    ],
  });
  if (canceled || !filePath) return;
  try {
    await wc.savePage(filePath, 'HTMLComplete');
    win.sendChrome('toast', { message: 'Page saved', action: { label: 'Show', command: 'showFile', arg: filePath } });
  } catch {
    win.sendChrome('toast', { message: 'Couldn’t save page', kind: 'error' });
  }
}


async function savePdf(win, tab) {
  const wc = tab?.webContents;
  if (!win || !wc || !/^(https?|file):/.test(tab.state.url)) return;
  const title = (tab.state.title || 'page').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  const { canceled, filePath } = await dialog.showSaveDialog(win.win, {
    title: 'Save page as PDF',
    defaultPath: path.join(ctx.settings.get('downloadDir') || app.getPath('downloads'), `${title}.pdf`),
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return;
  try {
    const pdf = await wc.printToPDF({ printBackground: true, preferCSSPageSize: true });
    await fs.promises.writeFile(filePath, pdf);
    win.sendChrome('toast', { message: 'PDF saved', action: { label: 'Show', command: 'showFile', arg: filePath } });
  } catch {
    win.sendChrome('toast', { message: 'Couldn’t save PDF', kind: 'error' });
  }
}

async function closeDuplicates(win) {
  if (!win) return;
  const candidates = duplicateTabs(win.tabs, win.activeTab);
  let closed = 0;
  for (const tab of candidates) {
    await win.closeTab(tab); // Keep each page's unsaved-work confirmation.
    if (!win.tabs.includes(tab)) closed++;
  }
  win.sendChrome('toast', { message: closed ? `Closed ${closed} duplicate tab${closed === 1 ? '' : 's'} — Ctrl+Shift+T to restore` : 'No duplicate tabs closed' });
}

async function sleepBackgroundTabs(win) {
  if (!win) return;
  const { response } = await dialog.showMessageBox(win.win, {
    type: 'question', title: 'Free browser memory',
    message: 'Sleep background tabs?',
    detail: 'Sleeping pages reload when you return. Save unfinished forms or edits first. Active, visible, pinned, loading, playing and developer-tool tabs stay awake.',
    buttons: ['Cancel', 'Sleep tabs'], defaultId: 0, cancelId: 0,
  });
  if (response !== 1 || win.win.isDestroyed()) return;
  let count = 0;
  for (const tab of win.tabs) if (tab.discard()) count++;
  win.sendChrome('toast', { message: `${count} background tab${count === 1 ? '' : 's'} put to sleep. Select a tab to wake it.` });
}

function reopenClosed(win) {
  const item = ctx.sessionState.popClosed();
  if (!item) return;
  restoreClosedItem(win, item);
}

function restoreClosedItem(win, item) {
  if (item.type === 'window') {
    windows().createWindow({ ...item.data, bounds: undefined });
    return;
  }
  const target = win && !win.isPrivate ? win : windows().getWindowOfKind(false) || windows().createWindow({ empty: true });
  const d = item.data;
  target.createTab({ url: d.url, title: d.title, favicon: d.favicon, pinned: d.pinned, history: d.history, index: item.index });
}

function togglePip(tab) {
  tab?.webContents
    ?.executeJavaScript(
      `(async () => {
        if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return true; }
        const videos = [...document.querySelectorAll('video')].filter(v => v.readyState > 0 && !v.disablePictureInPicture);
        const v = videos.find(v => !v.paused) || videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
        if (!v) return false;
        await v.requestPictureInPicture();
        return true;
      })()`,
      true,
    )
    .then((ok) => {
      if (!ok) tab.win.sendChrome('toast', { message: 'No video found on this page' });
    })
    .catch(() => tab.win.sendChrome('toast', { message: 'Picture‑in‑picture isn’t available here' }));
}

/**
 * Every browser action. `keys` are default accelerators (Electron syntax).
 * `pageFirst` shortcuts are offered to the web page first (so web apps like
 * Google Docs can use Ctrl+F/Ctrl+U/Ctrl+S); others always go to the browser.
 */
const COMMANDS = [
  // Tabs & windows
  { id: 'newTab', label: 'New tab', section: 'Tabs', keys: ['CmdOrCtrl+T'], run: ({ win }) => (win ? win.createTab() : windows().createWindow()) },
  { id: 'newWindow', label: 'New window', section: 'Tabs', keys: ['CmdOrCtrl+N'], run: () => windows().createWindow() },
  { id: 'newPrivateWindow', label: 'New private window', section: 'Tabs', keys: ['CmdOrCtrl+Shift+N'], run: () => windows().createWindow({ isPrivate: true }) },
  { id: 'closeTab', label: 'Close tab', section: 'Tabs', keys: ['CmdOrCtrl+W', ...(IS_MAC ? [] : ['CmdOrCtrl+F4'])], run: ({ win, tab }) => tab && win.closeTab(tab) },
  { id: 'closeWindow', label: 'Close window', section: 'Tabs', keys: ['CmdOrCtrl+Shift+W'], run: ({ win }) => win?.close() },
  { id: 'reopenClosed', label: 'Reopen closed tab', section: 'Tabs', keys: ['CmdOrCtrl+Shift+T'], run: ({ win }) => reopenClosed(win) },
  { id: 'nextTab', label: 'Next tab', section: 'Tabs', keys: ['Ctrl+Tab', 'CmdOrCtrl+PageDown', ...(IS_MAC ? ['Cmd+Alt+Right', 'Cmd+Shift+]'] : [])], palette: false, run: ({ win }) => win?.cycleTab(1) },
  { id: 'prevTab', label: 'Previous tab', section: 'Tabs', keys: ['Ctrl+Shift+Tab', 'CmdOrCtrl+PageUp', ...(IS_MAC ? ['Cmd+Alt+Left', 'Cmd+Shift+['] : [])], palette: false, run: ({ win }) => win?.cycleTab(-1) },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    id: `selectTab${n}`,
    label: `Go to tab ${n}`,
    section: 'Tabs',
    keys: [IS_MAC ? `Cmd+${n}` : `Ctrl+${n}`, ...(IS_MAC ? [] : [`Alt+${n}`])],
    palette: false,
    run: ({ win }) => win?.selectTabAt(n - 1),
  })),
  { id: 'lastTab', label: 'Go to last tab', section: 'Tabs', keys: [IS_MAC ? 'Cmd+9' : 'Ctrl+9'], palette: false, run: ({ win }) => win?.selectTabAt(-1) },
  { id: 'moveTabLeft', label: 'Move tab left', section: 'Tabs', keys: ['CmdOrCtrl+Shift+PageUp'], run: ({ win, tab }) => tab && win.moveTab(tab, win.tabs.indexOf(tab) - 1) },
  { id: 'moveTabRight', label: 'Move tab right', section: 'Tabs', keys: ['CmdOrCtrl+Shift+PageDown'], run: ({ win, tab }) => tab && win.moveTab(tab, win.tabs.indexOf(tab) + 1) },
  { id: 'duplicateTab', label: 'Duplicate tab', section: 'Tabs', run: ({ win, tab }) => tab && win.duplicateTab(tab) },
  { id: 'pinTab', label: 'Pin / unpin tab', section: 'Tabs', run: ({ win, tab }) => tab && win.togglePin(tab) },
  { id: 'muteTab', label: 'Mute / unmute tab', section: 'Tabs', run: ({ tab }) => tab?.setMuted(!tab.state.muted) },
  { id: 'closeOtherTabs', label: 'Close other tabs', section: 'Tabs', run: ({ win, tab }) => tab && win.closeOtherTabs(tab) },
  { id: 'moveToNewWindow', label: 'Move tab to new window', section: 'Tabs', run: ({ win, tab }) => tab && win.moveTabToNewWindow(tab) },
  { id: 'splitView', label: 'Split view with new tab', section: 'Tabs', run: ({ win }) => win?.splitWith() },
  { id: 'closeSplit', label: 'Exit split view', section: 'Tabs', run: ({ win }) => win?.closeSplit() },
  { id: 'searchTabs', label: 'Search tabs & commands', section: 'Tabs', keys: ['CmdOrCtrl+Shift+A', ...(IS_MAC ? [] : ['CmdOrCtrl+Shift+Space'])], palette: false, run: ({ win }) => win && openPalette(win) },

  // Navigation
  { id: 'back', label: 'Back', section: 'Navigation', keys: IS_MAC ? ['Cmd+[', 'Cmd+Left'] : ['Alt+Left', 'BrowserBack'], run: ({ tab }) => tab?.goBack() },
  { id: 'forward', label: 'Forward', section: 'Navigation', keys: IS_MAC ? ['Cmd+]', 'Cmd+Right'] : ['Alt+Right', 'BrowserForward'], run: ({ tab }) => tab?.goForward() },
  { id: 'reload', label: 'Reload', section: 'Navigation', keys: ['CmdOrCtrl+R', 'F5'], run: ({ tab }) => tab?.reload() },
  { id: 'hardReload', label: 'Hard reload (bypass cache)', section: 'Navigation', keys: ['CmdOrCtrl+Shift+R', 'Shift+F5', 'CmdOrCtrl+F5'], run: ({ tab }) => tab?.reload(true) },
  { id: 'stop', label: 'Stop loading', section: 'Navigation', keys: ['Escape'], pageFirst: true, palette: false, run: ({ tab }) => tab?.state.loading && tab.stop() },
  { id: 'home', label: 'Home page', section: 'Navigation', keys: IS_MAC ? ['Cmd+Shift+H'] : ['Alt+Home'], run: ({ tab }) => tab?.navigate(ctx.settings.get('homepage') || NEWTAB_URL) },
  { id: 'focusOmnibox', label: 'Focus address bar', section: 'Navigation', keys: ['CmdOrCtrl+L', ...(IS_MAC ? [] : ['Alt+D']), 'F6'], palette: false, run: ({ win }) => win?.focusOmnibox({ select: true }) },
  { id: 'searchWeb', label: 'Search the web', section: 'Navigation', keys: ['CmdOrCtrl+K', 'CmdOrCtrl+E'], pageFirst: true, palette: false, run: ({ win }) => win?.focusOmnibox({ text: '?', select: false }) },

  { id: 'closeDuplicateTabs', label: 'Close duplicate tabs', section: 'Tabs', run: ({ win }) => closeDuplicates(win) },
  { id: 'sleepBackgroundTabs', label: 'Sleep background tabs to free memory', section: 'Tabs', run: ({ win }) => sleepBackgroundTabs(win) },
  { id: 'savePdf', label: 'Save page as PDF…', section: 'Page', run: ({ win, tab }) => savePdf(win, tab) },
  { id: 'copyCleanUrl', label: 'Copy link without tracking parameters', section: 'Privacy', run: ({ win, tab }) => {
    if (!tab || !/^https?:/.test(tab.state.url)) return;
    clipboard.writeText(cleanLink(tab.state.url));
    win.sendChrome('toast', { message: 'Clean link copied' });
  } },

  // Page
  { id: 'find', label: 'Find in page', section: 'Page', keys: ['CmdOrCtrl+F'], pageFirst: true, run: ({ win }) => openFind(win) },
  { id: 'findNext', label: 'Find next', section: 'Page', keys: ['F3', 'CmdOrCtrl+G'], pageFirst: true, palette: false, run: ({ win }) => win?.sendChrome('find-step', { forward: true }) },
  { id: 'findPrev', label: 'Find previous', section: 'Page', keys: ['Shift+F3', 'CmdOrCtrl+Shift+G'], pageFirst: true, palette: false, run: ({ win }) => win?.sendChrome('find-step', { forward: false }) },
  { id: 'zoomIn', label: 'Zoom in', section: 'Page', keys: ['CmdOrCtrl+=', 'CmdOrCtrl+Plus', 'CmdOrCtrl+Shift+=', 'CmdOrCtrl+numadd'], run: ({ tab }) => tab?.zoom('in') },
  { id: 'zoomOut', label: 'Zoom out', section: 'Page', keys: ['CmdOrCtrl+-', 'CmdOrCtrl+numsub', 'CmdOrCtrl+Shift+-'], run: ({ tab }) => tab?.zoom('out') },
  { id: 'zoomReset', label: 'Reset zoom', section: 'Page', keys: ['CmdOrCtrl+0', 'CmdOrCtrl+num0'], run: ({ tab }) => tab?.zoom('reset') },
  { id: 'reader', label: 'Reader mode', section: 'Page', keys: ['CmdOrCtrl+Alt+R', ...(IS_MAC ? [] : ['F9'])], run: ({ tab }) => toggleReader(tab) },
  { id: 'print', label: 'Print…', section: 'Page', keys: ['CmdOrCtrl+P'], pageFirst: true, run: ({ tab }) => tab?.webContents?.print({}, () => {}) },
  { id: 'savePage', label: 'Save page as…', section: 'Page', keys: ['CmdOrCtrl+S'], pageFirst: true, run: ({ win, tab }) => savePage(win, tab) },
  { id: 'screenshot', label: 'Take screenshot (visible area)', section: 'Page', keys: ['CmdOrCtrl+Shift+S'], run: ({ win, tab }) => screenshot(win, tab, false) },
  { id: 'fullScreenshot', label: 'Take full-page screenshot', section: 'Page', run: ({ win, tab }) => screenshot(win, tab, true) },
  { id: 'pip', label: 'Picture-in-picture', section: 'Page', run: ({ tab }) => togglePip(tab) },
  {
    id: 'translate',
    label: 'Translate page',
    section: 'Page',
    run: ({ win, tab }) => {
      if (!tab || !/^https?:/.test(tab.state.url)) return;
      win.createTab({ url: `https://translate.google.com/translate?sl=auto&tl=${app.getLocale().split('-')[0] || 'en'}&u=${encodeURIComponent(tab.state.url)}`, index: win.tabs.indexOf(tab) + 1 });
    },
  },
  {
    id: 'copyUrl',
    label: 'Copy page address',
    section: 'Page',
    run: ({ win, tab }) => {
      if (!tab) return;
      clipboard.writeText(tab.state.url);
      win.sendChrome('toast', { message: 'Link copied' });
    },
  },
  { id: 'extensions', label: 'Developer extensions…', section: 'Developer', run: ({ win }) => require('./developer-extensions').manage(win) },
  { id: 'developerGuide', label: 'Website inspection guide', section: 'Developer', run: ({ win }) => require('./developer-extensions').guide(win) },
  { id: 'viewSource', label: 'View page source', section: 'Developer', keys: IS_MAC ? ['Cmd+Alt+U'] : ['Ctrl+U'], pageFirst: true, run: ({ win, tab }) => tab && /^(https?|file):/.test(tab.state.url) && win.createTab({ url: `view-source:${tab.state.url}`, index: win.tabs.indexOf(tab) + 1 }) },
  { id: 'devtools', label: 'Developer tools', section: 'Developer', keys: ['F12', ...(IS_MAC ? ['Cmd+Alt+I'] : ['Ctrl+Shift+I', 'Ctrl+Shift+J'])], run: ({ tab }) => tab?.toggleDevTools() },
  { id: 'inspect', label: 'Inspect element', section: 'Developer', keys: [IS_MAC ? 'Cmd+Shift+C' : 'Ctrl+Shift+C'], palette: false, run: ({ tab }) => tab?.openDevTools() },
  { id: 'taskManager', label: 'Task manager', section: 'Developer', keys: IS_MAC ? [] : ['Shift+Escape'], run: ({ win }) => openInternal(win, 'tasks') },

  { id: 'saveForLater', label: 'Save page to reading list', section: 'Bookmarks', run: ({ win, tab }) => {
    if (!tab || !/^https?:/.test(tab.state.url)) return;
    if (win.isPrivate) { win.sendChrome('toast', { message: 'Reading-list saving is disabled in private windows' }); return; }
    ctx.bookmarks.saveForLater({ url: tab.state.url, title: tab.state.title });
    win.sendChrome('toast', { message: 'Saved to reading list' });
  } },
  { id: 'readingList', label: 'Open reading list', section: 'Bookmarks', run: ({ win }) => {
    const folder = ctx.bookmarks.readingListFolder();
    const tab = openInternal(win, 'bookmarks');
    tab?.navigate(`lib://bookmarks/?folder=${encodeURIComponent(folder.id)}`);
  } },
  { id: 'copyTabLinks', label: 'Copy all open web-page links', section: 'Tabs', run: ({ win }) => {
    if (!win) return;
    const urls = [...new Set(win.tabs.map(t => t.state.url).filter(url => /^https?:/.test(url)))];
    if (!urls.length) { win.sendChrome('toast', { message: 'No web-page links to copy' }); return; }
    clipboard.writeText(urls.join('\n'));
    win.sendChrome('toast', { message: `Copied ${urls.length} unique link${urls.length === 1 ? '' : 's'}` });
  } },
  { id: 'vpnSetup', label: 'VPN setup guide', section: 'Privacy', run: ({ win }) => {
    const tab = openInternal(win, 'settings');
    tab?.navigate('lib://settings/#vpn');
  } },

  { id: 'workspaces', label: 'Saved workspaces', section: 'Tabs', run: ({ win }) => openInternal(win, 'workspaces') },

  // Library
  { id: 'bookmarkPage', label: 'Bookmark this page', section: 'Bookmarks', keys: ['CmdOrCtrl+D'], pageFirst: true, run: ({ win }) => win?.sendChrome('bookmark-edit', {}) },
  {
    id: 'bookmarkAllTabs',
    label: 'Bookmark all tabs',
    section: 'Bookmarks',
    keys: ['CmdOrCtrl+Shift+D'],
    run: ({ win }) => {
      if (!win) return;
      const folder = ctx.bookmarks.add({ parentId: 'other', type: 'folder', title: `Tabs — ${new Date().toLocaleDateString()}` });
      for (const t of win.tabs) if (/^https?:/.test(t.state.url)) ctx.bookmarks.add({ parentId: folder.id, title: t.state.title || t.state.url, url: t.state.url });
      win.sendChrome('toast', { message: 'All tabs bookmarked in “Other bookmarks”' });
    },
  },
  { id: 'toggleBookmarksBar', label: 'Show / hide bookmarks bar', section: 'Bookmarks', keys: ['CmdOrCtrl+Shift+B'], run: () => ctx.settings.set('showBookmarksBar', !ctx.settings.get('showBookmarksBar')) },
  { id: 'bookmarksManager', label: 'Bookmarks manager', section: 'Bookmarks', keys: ['CmdOrCtrl+Shift+O'], run: ({ win }) => openInternal(win, 'bookmarks') },
  { id: 'history', label: 'History', section: 'Library', keys: [IS_MAC ? 'Cmd+Y' : 'Ctrl+H'], pageFirst: true, run: ({ win }) => openInternal(win, 'history') },
  { id: 'downloads', label: 'Downloads', section: 'Library', keys: [IS_MAC ? 'Cmd+Shift+J' : 'Ctrl+J'], pageFirst: !IS_MAC, run: ({ win }) => openInternal(win, 'downloads') },
  { id: 'settings', label: 'Settings', section: 'Library', keys: ['CmdOrCtrl+,'], run: ({ win }) => openInternal(win, 'settings') },
  { id: 'clearData', label: 'Clear browsing data…', section: 'Privacy', keys: [IS_MAC ? 'Cmd+Shift+Backspace' : 'Ctrl+Shift+Delete'], run: ({ win }) => {
    const tab = openInternal(win, 'settings');
    if (tab) setTimeout(() => tab.webContents?.send('lib:page-event', 'open-section', 'clear'), 400);
  } },
  {
    id: 'toggleAdblockSite',
    label: 'Toggle ad blocking on this site',
    section: 'Privacy',
    run: ({ win, tab }) => {
      if (!tab) return;
      const host = (() => {
        try {
          return new URL(tab.state.url).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      })();
      if (!host) return;
      const list = ctx.settings.get('adblockAllowlist') || [];
      const on = list.includes(host);
      ctx.settings.set('adblockAllowlist', on ? list.filter((h) => h !== host) : [...list, host]);
      win.sendChrome('toast', { message: on ? `Blocking ads on ${host}` : `Ads allowed on ${host}` });
      tab.reload();
    },
  },

  { id: 'dataSaverSettings', label: 'Data Saver settings', section: 'View', run: ({ win }) => { const t = openInternal(win, 'settings'); t?.navigate('lib://settings/#data-saver'); } },
  { id: 'toggleDataSaver', label: 'Data Saver on / off', section: 'View', run: ({ win }) => {
    const on = ctx.settings.get('dataSaverMode') !== 'off';
    ctx.settings.set('dataSaverMode', on ? 'off' : 'balanced');
    win?.sendChrome('toast', { message: `Data Saver ${on ? 'off' : 'on (Balanced)'}. Reload pages to apply.` });
  } },
  { id: 'toggleDataSaverSite', label: 'Allow / save data on this site', section: 'View', run: ({ win, tab }) => {
    if (!tab || !/^https?:/.test(tab.state.url)) return;
    const host = new URL(tab.state.url).hostname.toLowerCase();
    const list = ctx.settings.get('dataSaverAllowlist') || [];
    const allowed = list.includes(host);
    if (!ctx.settings.set('dataSaverAllowlist', allowed ? list.filter(x => x !== host) : [...list, host])) return;
    win.sendChrome('toast', { message: allowed ? 'Site exception removed. Reload to apply.' : 'Full content allowed on this site. Reload to apply.' });
  } },

  // View
  { id: 'fullscreen', label: 'Full screen', section: 'View', keys: IS_MAC ? ['Cmd+Ctrl+F'] : ['F11'], run: ({ win }) => win?.toggleFullscreen() },
  {
    id: 'toggleTheme',
    label: 'Switch light / dark theme',
    section: 'View',
    run: () => {
      const dark = ctx.settings.get('theme') === 'dark' || (ctx.settings.get('theme') === 'system' && nativeTheme.shouldUseDarkColors);
      ctx.settings.set('theme', dark ? 'light' : 'dark');
    },
  },
  { id: 'toggleVerticalTabs', label: 'Vertical tabs on / off', section: 'View', run: () => ctx.settings.set('verticalTabs', !ctx.settings.get('verticalTabs')) },
  { id: 'toggleCompact', label: 'Compact mode on / off', section: 'View', run: () => ctx.settings.set('compactMode', !ctx.settings.get('compactMode')) },

  // App
  { id: 'about', label: 'About LIB Browser', section: 'Help', run: ({ win }) => openInternal(win, 'about') },
  { id: 'shortcuts', label: 'Keyboard shortcuts', section: 'Help', run: ({ win }) => openInternal(win, 'shortcuts') },
  { id: 'quit', label: 'Quit LIB Browser', section: 'App', keys: IS_MAC ? ['Cmd+Q'] : ['Ctrl+Shift+Q'], run: () => app.quit() },
  // Internal helpers (not in the palette).
  { id: 'showFile', label: 'Show file', palette: false, run: ({ arg }) => typeof arg === 'string' && shell.showItemInFolder(arg) },
];

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

function openFind(win) {
  if (!win) return;
  win.chromeView.webContents.focus();
  win.sendChrome('find-open', { tabId: win.activeTab?.id ?? null });
}

function openPalette(win) {
  win.chromeView.webContents.focus();
  win.sendChrome('palette-open', {});
}

async function toggleReader(tab) {
  if (!tab) return;
  if (tab.state.url.startsWith('lib://reader')) {
    if (tab.state.canGoBack) tab.goBack();
    else {
      try {
        const orig = new URL(tab.state.url).searchParams.get('url');
        if (orig) tab.navigate(orig);
      } catch {
        /* ignore */
      }
    }
    return;
  }
  const ok = await tab.openReader();
  if (!ok) tab.win.sendChrome('toast', { message: 'Reader mode isn’t available for this page' });
}

/**
 * Run a command by id.
 * @param {string} id
 * @param {{ win?: any, tab?: any, arg?: any }} [context]
 */
function run(id, context = {}) {
  const cmd = BY_ID.get(id);
  if (!cmd) return false;
  const win = context.win !== undefined ? context.win : windows().getFocusedWindow();
  const tab = context.tab !== undefined ? context.tab : win?.activeTab || null;
  try {
    const r = cmd.run({ win, tab, arg: context.arg });
    if (r && typeof r.catch === 'function') r.catch((err) => console.error(`[command ${id}]`, err));
  } catch (err) {
    console.error(`[command ${id}]`, err);
  }
  return true;
}

/** Display string for an accelerator, e.g. "Ctrl+Shift+T" or "⌘⇧T". */
function formatAccelerator(accel) {
  if (!accel) return '';
  const parts = accel.split('+');
  const key = parts.pop();
  const keyName =
    { Plus: '+', numadd: 'Num+', numsub: 'Num−', num0: 'Num0', PageUp: 'PgUp', PageDown: 'PgDn', Escape: 'Esc', Left: '←', Right: '→', BrowserBack: 'Back', BrowserForward: 'Forward' }[key] ||
    (key.length === 1 ? key.toUpperCase() : key);
  if (IS_MAC) {
    const sym = { CmdOrCtrl: '⌘', Cmd: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' };
    const order = ['Ctrl', 'Alt', 'Shift', 'CmdOrCtrl', 'Cmd'];
    return parts.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((p) => sym[p] || p).join('') + keyName;
  }
  return [...parts.map((p) => (p === 'CmdOrCtrl' ? 'Ctrl' : p)), keyName].join('+');
}

/** Command list for the palette / shortcuts page. */
function list() {
  return COMMANDS.filter((c) => c.palette !== false).map((c) => ({
    id: c.id,
    label: c.label,
    section: c.section,
    shortcut: c.keys && c.keys.length ? formatAccelerator(c.keys[0]) : '',
  }));
}

function allShortcuts() {
  return COMMANDS.filter((c) => c.keys && c.keys.length).map((c) => ({
    id: c.id,
    label: c.label,
    section: c.section || 'Other',
    shortcuts: c.keys.map(formatAccelerator),
  }));
}

module.exports = {
  COMMANDS,
  BY_ID,
  run,
  list,
  allShortcuts,
  formatAccelerator,
  openInternal,
  restoreClosedItem,
  togglePip,
  screenshot,
  toggleReader,
};
