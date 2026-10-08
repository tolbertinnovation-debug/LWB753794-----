'use strict';

const { Menu, clipboard, app, shell } = require('electron');
const ctx = require('./context');
const commands = require('./commands');
const { resolveInput } = require('./url-utils');
const { getEngine } = require('./search-engines');

const IS_MAC = process.platform === 'darwin';
const sep = { type: 'separator' };

function windows() {
  return require('./windows');
}

function truncate(s, n) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function popup(menu, win, pos) {
  const opts = { window: win.win };
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    opts.x = Math.round(pos.x);
    opts.y = Math.round(pos.y);
  }
  // Menus open over the page; keep the UI view raised meanwhile (none needed
  // for native menus, but clear hover status).
  win.setStatus('');
  menu.popup(opts);
}

/** Run JS against the media element under the cursor. */
function mediaAction(tab, params, action) {
  const zoom = tab.webContents.getZoomFactor() || 1;
  const x = params.x / zoom;
  const y = params.y / zoom;
  const code = `(async () => {
    const el = document.elementFromPoint(${x}, ${y});
    const m = el && (el.closest('video,audio') || (el.querySelector && el.querySelector('video,audio')));
    if (!m) return;
    switch (${JSON.stringify(action)}) {
      case 'play': m.paused ? m.play() : m.pause(); break;
      case 'mute': m.muted = !m.muted; break;
      case 'loop': m.loop = !m.loop; break;
      case 'controls': m.controls = !m.controls; break;
      case 'pip': document.pictureInPictureElement ? document.exitPictureInPicture() : m.requestPictureInPicture(); break;
    }
  })()`;
  (params.frame || tab.webContents).executeJavaScript(code, true).catch(() => {});
}

function openLink(win, tab, url, where) {
  const isPrivate = win.isPrivate;
  if (where === 'tab') win.createTab({ url, background: true, openerTabId: tab.id, index: win.indexForOpenedTab(tab) });
  else if (where === 'foreground') win.createTab({ url, openerTabId: tab.id, index: win.indexForOpenedTab(tab) });
  else if (where === 'window') windows().createWindow({ url, isPrivate });
  else if (where === 'private') windows().createWindow({ url, isPrivate: true });
  else if (where === 'split') {
    const t = win.createTab({ url, background: true, openerTabId: tab.id, index: win.indexForOpenedTab(tab) });
    win.openSplit(tab, t);
  }
}

function showPageContextMenu(tab, params) {
  const win = tab.win;
  const wc = tab.webContents;
  if (!wc) return;
  const items = [];
  const link = params.linkURL && !/^javascript:/i.test(params.linkURL) ? params.linkURL : '';
  const engine = getEngine(ctx.settings.get('searchEngine'), ctx.settings.get('customSearchUrl'));

  if (link) {
    items.push(
      { label: 'Open link in new tab', click: () => openLink(win, tab, link, 'tab') },
      { label: 'Open link in new window', click: () => openLink(win, tab, link, 'window') },
      { label: 'Open link in private window', click: () => openLink(win, tab, link, 'private') },
    );
    if (!win.split) items.push({ label: 'Open link in split view', click: () => openLink(win, tab, link, 'split') });
    items.push(
      sep,
      {
        label: 'Save link as…',
        click: () => {
          ctx.downloads.expectSaveAs(link);
          wc.downloadURL(link);
        },
      },
      { label: 'Copy link address', click: () => clipboard.writeText(link) },
    );
    if (params.linkText && params.linkText.trim() && params.mediaType === 'none') {
      items.push({ label: 'Copy link text', click: () => clipboard.writeText(params.linkText.trim()) });
    }
    items.push(sep);
  }

  if (params.mediaType === 'image' && params.srcURL) {
    const src = params.srcURL;
    items.push(
      { label: 'Open image in new tab', click: () => openLink(win, tab, src, 'tab') },
      {
        label: 'Save image as…',
        click: () => {
          ctx.downloads.expectSaveAs(src);
          wc.downloadURL(src);
        },
      },
      { label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Copy image address', click: () => clipboard.writeText(src) },
    );
    if (/^https?:/.test(src)) {
      items.push({
        label: 'Search image with Google Lens',
        click: () => openLink(win, tab, `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(src)}`, 'foreground'),
      });
    }
    items.push(sep);
  }

  if ((params.mediaType === 'video' || params.mediaType === 'audio') && params.mediaFlags) {
    const f = params.mediaFlags;
    items.push(
      { label: f.isPaused ? 'Play' : 'Pause', click: () => mediaAction(tab, params, 'play') },
      { label: 'Mute', type: 'checkbox', checked: f.isMuted, click: () => mediaAction(tab, params, 'mute') },
      { label: 'Loop', type: 'checkbox', checked: f.isLooping, click: () => mediaAction(tab, params, 'loop') },
      { label: 'Show controls', type: 'checkbox', checked: f.isControlsVisible, click: () => mediaAction(tab, params, 'controls') },
    );
    if (params.mediaType === 'video') {
      items.push({ label: 'Picture-in-picture', type: 'checkbox', checked: Boolean(f.isShowingPictureInPicture), click: () => mediaAction(tab, params, 'pip') });
    }
    if (params.srcURL && /^https?:/.test(params.srcURL)) {
      items.push(
        sep,
        { label: `Open ${params.mediaType} in new tab`, click: () => openLink(win, tab, params.srcURL, 'tab') },
        {
          label: `Save ${params.mediaType} as…`,
          click: () => {
            ctx.downloads.expectSaveAs(params.srcURL);
            wc.downloadURL(params.srcURL);
          },
        },
        { label: `Copy ${params.mediaType} address`, click: () => clipboard.writeText(params.srcURL) },
      );
    }
    items.push(sep);
  }

  if (params.isEditable) {
    if (params.misspelledWord) {
      const suggestions = (params.dictionarySuggestions || []).slice(0, 5);
      for (const s of suggestions) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      if (!suggestions.length) items.push({ label: 'No spelling suggestions', enabled: false });
      items.push(
        { label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        sep,
      );
    }
    const e = params.editFlags;
    items.push(
      { label: 'Undo', enabled: e.canUndo, click: () => wc.undo(), accelerator: 'CmdOrCtrl+Z', registerAccelerator: false },
      { label: 'Redo', enabled: e.canRedo, click: () => wc.redo(), accelerator: IS_MAC ? 'Cmd+Shift+Z' : 'Ctrl+Y', registerAccelerator: false },
      sep,
      { label: 'Cut', enabled: e.canCut, click: () => wc.cut(), accelerator: 'CmdOrCtrl+X', registerAccelerator: false },
      { label: 'Copy', enabled: e.canCopy, click: () => wc.copy(), accelerator: 'CmdOrCtrl+C', registerAccelerator: false },
      { label: 'Paste', enabled: e.canPaste, click: () => wc.paste(), accelerator: 'CmdOrCtrl+V', registerAccelerator: false },
      { label: 'Paste as plain text', enabled: e.canPaste, click: () => wc.pasteAndMatchStyle(), accelerator: 'CmdOrCtrl+Shift+V', registerAccelerator: false },
      { label: 'Select all', enabled: e.canSelectAll, click: () => wc.selectAll(), accelerator: 'CmdOrCtrl+A', registerAccelerator: false },
    );
    if (params.selectionText && params.selectionText.trim()) {
      const text = params.selectionText.trim();
      items.push(sep, {
        label: `Search ${engine.name} for “${truncate(text, 28)}”`,
        click: () => openLink(win, tab, resolveInput(`?${text}`, searchOpts()).url, 'foreground'),
      });
    }
    items.push(sep);
  } else if (params.selectionText && params.selectionText.trim()) {
    const text = params.selectionText.trim();
    items.push({ label: 'Copy', click: () => wc.copy(), accelerator: 'CmdOrCtrl+C', registerAccelerator: false });
    const asUrl = !/\s/.test(text) && text.length < 2048 ? resolveInput(text, searchOpts()) : null;
    if (asUrl && asUrl.type === 'url' && /^https?:/.test(asUrl.url)) {
      items.push({ label: `Go to ${truncate(text, 40)}`, click: () => openLink(win, tab, asUrl.url, 'foreground') });
    }
    items.push(
      {
        label: `Search ${engine.name} for “${truncate(text, 28)}”`,
        click: () => openLink(win, tab, resolveInput(`?${text}`, searchOpts()).url, 'foreground'),
      },
      {
        label: 'Translate selection',
        click: () => openLink(win, tab, `https://translate.google.com/?sl=auto&text=${encodeURIComponent(text.slice(0, 4000))}`, 'foreground'),
      },
      sep,
    );
  }

  if (!link && params.mediaType === 'none' && !params.isEditable && !params.selectionText) {
    items.push(
      { label: 'Back', enabled: tab.state.canGoBack, click: () => tab.goBack() },
      { label: 'Forward', enabled: tab.state.canGoForward, click: () => tab.goForward() },
      { label: 'Reload', click: () => tab.reload() },
      sep,
      { label: 'Save as…', click: () => commands.run('savePage', { win, tab }) },
      { label: 'Print…', click: () => commands.run('print', { win, tab }) },
    );
    if (/^https?:/.test(tab.state.url)) {
      items.push(
        { label: 'Translate page', click: () => commands.run('translate', { win, tab }) },
        { label: 'Copy page address', click: () => commands.run('copyUrl', { win, tab }) },
      );
    }
    if (tab.state.readerable || tab.state.url.startsWith('lib://reader')) {
      items.push({ label: tab.state.url.startsWith('lib://reader') ? 'Exit reader mode' : 'Open in reader mode', click: () => commands.toggleReader(tab) });
    }
    items.push(
      { label: 'Take screenshot', click: () => commands.screenshot(win, tab, false) },
      sep,
    );
    if (/^(https?|file):/.test(tab.state.url)) items.push({ label: 'View page source', click: () => commands.run('viewSource', { win, tab }) });
  }
  items.push({ label: 'Inspect', click: () => tab.inspectElement(params.x, params.y) });

  // Collapse duplicate/leading/trailing separators.
  const clean = items.filter((it, i, arr) => it.type !== 'separator' || (i > 0 && arr[i - 1].type !== 'separator' && i < arr.length - 1));
  popup(Menu.buildFromTemplate(clean), win);
}

function searchOpts() {
  return { searchEngine: ctx.settings.get('searchEngine'), customSearchUrl: ctx.settings.get('customSearchUrl') };
}

function showTabContextMenu(win, tab, pos) {
  if (!tab) return;
  const index = win.tabs.indexOf(tab);
  const others = win.tabs.filter((t) => t !== tab && !t.state.pinned);
  const inSplit = win.split && win.split.tabIds.includes(tab.id);
  const template = [
    { label: 'New tab to the right', click: () => win.createTab({ index: index + 1 }) },
    sep,
    { label: 'Reload', click: () => tab.reload() },
    { label: 'Duplicate', click: () => win.duplicateTab(tab) },
    { label: 'Close duplicate tabs', click: () => commands.run('closeDuplicateTabs', { win }) },
    { label: 'Sleep background tabs', click: () => commands.run('sleepBackgroundTabs', { win }) },
    { label: tab.state.pinned ? 'Unpin' : 'Pin', click: () => win.togglePin(tab) },
    { label: tab.state.muted ? 'Unmute site' : 'Mute site', click: () => tab.setMuted(!tab.state.muted) },
    sep,
    inSplit
      ? { label: 'Exit split view', click: () => win.closeSplit() }
      : tab === win.activeTab
        ? { label: 'Split view with new tab', click: () => win.splitWith() }
        : { label: 'Split view with current tab', click: () => win.openSplit(win.activeTab, tab) },
    { label: 'Move to new window', enabled: win.tabs.length > 1, click: () => win.moveTabToNewWindow(tab) },
    {
      label: ctx.bookmarks.isBookmarked(tab.state.url) ? 'Remove bookmark' : 'Bookmark tab',
      enabled: /^https?:|^file:/.test(tab.state.url),
      click: () => {
        if (ctx.bookmarks.isBookmarked(tab.state.url)) ctx.bookmarks.removeUrl(tab.state.url);
        else ctx.bookmarks.add({ parentId: 'bar', title: tab.state.title || tab.state.url, url: tab.state.url });
      },
    },
    sep,
    { label: 'Close', click: () => win.closeTab(tab), accelerator: 'CmdOrCtrl+W', registerAccelerator: false },
    { label: 'Close other tabs', enabled: others.length > 0, click: () => win.closeOtherTabs(tab) },
    { label: 'Close tabs to the right', enabled: index < win.tabs.length - 1, click: () => win.closeTabsToRight(tab) },
    sep,
    { label: 'Reopen closed tab', accelerator: 'CmdOrCtrl+Shift+T', registerAccelerator: false, click: () => commands.run('reopenClosed', { win }) },
  ];
  popup(Menu.buildFromTemplate(template), win, pos);
}

/** Long-press / right-click on Back or Forward: the session history list. */
function showNavHistoryMenu(win, direction, pos) {
  const tab = win.activeTab;
  const wc = tab?.webContents;
  if (!wc) return;
  const entries = wc.navigationHistory.getAllEntries();
  const current = wc.navigationHistory.getActiveIndex();
  const indices = [];
  if (direction === 'back') for (let i = current - 1; i >= 0 && indices.length < 15; i--) indices.push(i);
  else for (let i = current + 1; i < entries.length && indices.length < 15; i++) indices.push(i);
  if (!indices.length) return;
  const template = indices.map((i) => ({
    label: truncate(entries[i].title || entries[i].url, 60),
    click: () => tab.goToIndex(i),
  }));
  template.push(sep, { label: 'Show full history', click: () => commands.openInternal(win, 'history') });
  popup(Menu.buildFromTemplate(template), win, pos);
}

function showRecentlyClosedMenu(win, pos) {
  const items = ctx.sessionState.recentlyClosed(12);
  const template = items.length
    ? items.map((it) => ({
        label: it.type === 'window' ? `Window (${truncate(it.title, 40)})` : truncate(it.title, 60),
        click: () => {
          const item = ctx.sessionState.takeClosed(it.index);
          if (item) commands.restoreClosedItem(win, item);
        },
      }))
    : [{ label: 'No recently closed tabs', enabled: false }];
  popup(Menu.buildFromTemplate(template), win, pos);
}

function openBookmarkUrl(win, url, where = 'current') {
  if (/^javascript:/i.test(url)) {
    win.activeTab?.runBookmarklet(url);
    return;
  }
  if (where === 'current' && win.activeTab) win.activeTab.navigate(url);
  else if (where === 'window') windows().createWindow({ url, isPrivate: win.isPrivate });
  else if (where === 'private') windows().createWindow({ url, isPrivate: true });
  else win.createTab({ url, background: where === 'background' });
}

function bookmarkFolderTemplate(win, folder) {
  const children = folder.children || [];
  if (!children.length) return [{ label: '(empty)', enabled: false }];
  const out = children.map((c) =>
    c.type === 'folder'
      ? { label: truncate(c.title, 50), submenu: bookmarkFolderTemplate(win, c) }
      : { label: truncate(c.title || c.url, 60), click: () => openBookmarkUrl(win, c.url) },
  );
  const urls = children.filter((c) => c.type === 'bookmark' && !/^javascript:/i.test(c.url)).map((c) => c.url);
  if (urls.length > 1) {
    out.push(sep, { label: `Open all (${urls.length})`, click: () => urls.forEach((u) => win.createTab({ url: u, background: true })) });
  }
  return out;
}

function showBookmarkFolderMenu(win, folderId, pos) {
  const folder = ctx.bookmarks.get(folderId);
  if (!folder || folder.type !== 'folder') return;
  popup(Menu.buildFromTemplate(bookmarkFolderTemplate(win, folder)), win, pos);
}

function showBookmarkItemMenu(win, id, pos) {
  const node = id ? ctx.bookmarks.get(id) : null;
  if (id && !node) return;
  const template = [];
  if (!node) {
    // Right-click on the empty part of the bar.
  } else if (node.type === 'bookmark') {
    template.push(
      { label: 'Open in new tab', click: () => openBookmarkUrl(win, node.url, 'background') },
      { label: 'Open in new window', click: () => openBookmarkUrl(win, node.url, 'window') },
      { label: 'Open in private window', click: () => openBookmarkUrl(win, node.url, 'private') },
      sep,
      { label: 'Edit…', click: () => win.sendChrome('bookmark-edit', { id }) },
      { label: 'Copy link', click: () => clipboard.writeText(node.url) },
    );
  } else {
    template.push(...bookmarkFolderTemplate(win, node), sep, { label: 'Rename…', click: () => win.sendChrome('bookmark-edit', { id }) });
  }
  if (node) template.push({ label: 'Delete', click: () => ctx.bookmarks.remove(id) }, sep);
  template.push(
    { label: 'Add page to bookmarks bar', enabled: Boolean(win.activeTab && /^https?:/.test(win.activeTab.state.url)), click: () => win.activeTab && ctx.bookmarks.add({ parentId: 'bar', title: win.activeTab.state.title, url: win.activeTab.state.url }) },
    { label: 'Add folder', click: () => ctx.bookmarks.add({ parentId: 'bar', type: 'folder', title: 'New folder' }) },
    { label: 'Show bookmarks bar', type: 'checkbox', checked: ctx.settings.get('showBookmarksBar'), click: () => commands.run('toggleBookmarksBar') },
    { label: 'Bookmarks manager', click: () => commands.openInternal(win, 'bookmarks') },
  );
  popup(Menu.buildFromTemplate(template), win, pos);
}

/** Right-click in the address bar. */
function showOmniboxMenu(win, args = {}, pos) {
  const text = clipboard.readText().trim();
  const send = (action, extra = {}) => win.sendChrome('omnibox-menu', { action, ...extra });
  const pasteGo = text ? resolveInput(text.split(/\r?\n/)[0], searchOpts()) : null;
  const template = [
    { label: 'Undo', click: () => send('undo') },
    sep,
    { label: 'Cut', enabled: Boolean(args.hasSelection), click: () => send('cut') },
    { label: 'Copy', enabled: Boolean(args.hasSelection), click: () => send('copy') },
    { label: 'Paste', enabled: Boolean(text), click: () => send('paste', { text }) },
    {
      label: pasteGo && pasteGo.type === 'search' ? `Paste and search for “${truncate(text, 24)}”` : 'Paste and go',
      enabled: Boolean(pasteGo),
      click: () => pasteGo && win.activeTab?.navigate(pasteGo.url, { typed: true }),
    },
    { label: 'Delete', enabled: Boolean(args.hasSelection), click: () => send('delete') },
    sep,
    { label: 'Select all', enabled: Boolean(args.hasText), click: () => send('selectAll') },
  ];
  popup(Menu.buildFromTemplate(template), win, pos);
}

/** Right-click in any other text field of the browser UI (find bar, dialogs…). */
function showUiEditMenu(win, params) {
  if (!params.isEditable) return;
  const wc = win.chromeView.webContents;
  const e = params.editFlags;
  const template = [
    { label: 'Undo', enabled: e.canUndo, click: () => wc.undo() },
    { label: 'Redo', enabled: e.canRedo, click: () => wc.redo() },
    sep,
    { label: 'Cut', enabled: e.canCut, click: () => wc.cut() },
    { label: 'Copy', enabled: e.canCopy, click: () => wc.copy() },
    { label: 'Paste', enabled: e.canPaste, click: () => wc.paste() },
    { label: 'Select all', enabled: e.canSelectAll, click: () => wc.selectAll() },
  ];
  popup(Menu.buildFromTemplate(template), win);
}

/**
 * Application menu. On macOS it's the global menu bar and owns the
 * keyboard shortcuts; on Windows/Linux it is not shown (the UI has its own
 * menu and shortcuts are dispatched by shortcuts.js).
 */
function buildApplicationMenu() {
  if (!IS_MAC) {
    Menu.setApplicationMenu(null);
    return;
  }
  const cmd = (id, extra = {}) => {
    const c = commands.BY_ID.get(id);
    const [first, ...rest] = c.keys || [];
    const items = [
      {
        label: extra.label || c.label,
        accelerator: first,
        registerAccelerator: !c.pageFirst,
        click: () => commands.run(id),
      },
    ];
    // Extra accelerators become hidden duplicates.
    if (!c.pageFirst) {
      for (const k of rest) items.push({ label: c.label, accelerator: k, visible: false, acceleratorWorksWhenHidden: true, click: () => commands.run(id) });
    }
    return items;
  };
  const template = [
    {
      label: app.name,
      submenu: [
        { label: 'About LIB Browser', click: () => commands.run('about') },
        sep,
        ...cmd('settings', { label: 'Settings…' }),
        sep,
        { role: 'services' },
        sep,
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        sep,
        ...cmd('quit'),
      ],
    },
    {
      label: 'File',
      submenu: [...cmd('newTab'), ...cmd('newWindow'), ...cmd('newPrivateWindow'), ...cmd('reopenClosed'), sep, ...cmd('focusOmnibox', { label: 'Open Location…' }), sep, ...cmd('closeTab'), ...cmd('closeWindow'), sep, ...cmd('savePage'), sep, ...cmd('print')],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        sep,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        sep,
        ...cmd('find', { label: 'Find…' }),
        ...cmd('findNext'),
        ...cmd('findPrev'),
        sep,
        { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...cmd('toggleBookmarksBar', { label: 'Toggle Bookmarks Bar' }),
        ...cmd('toggleVerticalTabs'),
        ...cmd('toggleCompact'),
        sep,
        ...cmd('stop'),
        ...cmd('reload'),
        ...cmd('hardReload'),
        sep,
        ...cmd('fullscreen', { label: 'Enter Full Screen' }),
        ...cmd('zoomReset', { label: 'Actual Size' }),
        ...cmd('zoomIn'),
        ...cmd('zoomOut'),
        sep,
        ...cmd('reader'),
        sep,
        {
          label: 'Developer',
          submenu: [...cmd('viewSource'), ...cmd('devtools'), ...cmd('inspect'), ...cmd('extensions'), ...cmd('resourceExporter'), ...cmd('developerGuide'), ...cmd('taskManager')],
        },
      ],
    },
    {
      label: 'History',
      submenu: [...cmd('home'), ...cmd('back'), ...cmd('forward'), sep, ...cmd('history', { label: 'Show Full History' })],
    },
    {
      label: 'Bookmarks',
      submenu: [...cmd('bookmarksManager'), ...cmd('bookmarkPage', { label: 'Bookmark This Tab…' }), ...cmd('bookmarkAllTabs', { label: 'Bookmark All Tabs…' })],
    },
    {
      label: 'Tab',
      submenu: [
        ...cmd('nextTab', { label: 'Select Next Tab' }),
        ...cmd('prevTab', { label: 'Select Previous Tab' }),
        ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => cmd(`selectTab${n}`)),
        ...cmd('lastTab'),
        sep,
        ...cmd('moveTabLeft'),
        ...cmd('moveTabRight'),
        ...cmd('searchTabs', { label: 'Search Tabs…' }),
        sep,
        ...cmd('duplicateTab'),
        ...cmd('pinTab'),
        ...cmd('muteTab'),
        ...cmd('splitView'),
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, sep, ...cmd('downloads'), ...cmd('screenshot'), sep, { role: 'front' }],
    },
    {
      role: 'help',
      submenu: [...cmd('shortcuts'), { label: 'LIB Browser on GitHub', click: () => shell.openExternal('https://github.com/tolbertinnovation-debug/Lib-Web-browser') }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = {
  showPageContextMenu,
  showTabContextMenu,
  showNavHistoryMenu,
  showRecentlyClosedMenu,
  showBookmarkFolderMenu,
  showBookmarkItemMenu,
  showOmniboxMenu,
  showUiEditMenu,
  openBookmarkUrl,
  buildApplicationMenu,
};
