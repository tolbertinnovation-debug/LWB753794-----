'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ipcMain, app, dialog, shell, clipboard, nativeTheme, webContents: WebContents } = require('electron');
const ctx = require('./context');
const { apiMethod, trustedInternalFrame } = require('./security-policy');
const windows = require('./windows');
const commands = require('./commands');
const menus = require('./menus');
const shortcuts = require('./shortcuts');
const reader = require('./reader');
const { resolveInput, hostOf, originOf } = require('./url-utils');
const { localSuggestions, remoteSuggestions } = require('./suggestions');
const { SEARCH_ENGINES, KEYWORDS, getEngine } = require('./search-engines');
const { ACCENTS } = require('./settings');
const { getBrowsingSession } = require('./sessions');
const { PROMPTABLE } = require('./permissions');

/** Effective theme (settings + OS), independent of Chromium's media queries. */
function isDarkTheme() {
  const theme = ctx.settings.get('theme');
  return theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
}

function searchOpts() {
  return { searchEngine: ctx.settings.get('searchEngine'), customSearchUrl: ctx.settings.get('customSearchUrl') };
}

/** Settings the browser UI needs to render itself. */
function chromeSettings() {
  const s = ctx.settings.all();
  const engine = getEngine(s.searchEngine, s.customSearchUrl);
  return {
    theme: s.theme,
    accentColor: s.accentColor,
    showBookmarksBar: s.showBookmarksBar,
    showHomeButton: s.showHomeButton,
    verticalTabs: s.verticalTabs,
    compactMode: s.compactMode,
    searchEngineName: engine.name,
    adblockEnabled: s.adblockEnabled,
    systemDark: nativeTheme.shouldUseDarkColors,
  };
}

function bookmarksBar() {
  const urls = ctx.history.data.urls;
  return ctx.bookmarks.barItems().map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    url: n.url || '',
    favicon: n.url ? urls[n.url]?.favicon || urls[`${n.url.replace(/\/$/, '')}/`]?.favicon || '' : '',
    count: n.children ? n.children.length : 0,
  }));
}

function downloadsFor(win) {
  const s = ctx.downloads.summary(win.isPrivate);
  return s;
}

// ------------------------------------------------------------ browser UI API

/**
 * Open a URL (already resolved) according to a disposition.
 * @param {'current'|'tab'|'background'|'window'|'private'} where
 */
function openUrlIn(win, url, where = 'current', extra = {}) {
  if (where === 'current' && win.activeTab) win.activeTab.navigate(url, extra);
  else if (where === 'window') windows.createWindow({ url, isPrivate: win.isPrivate });
  else if (where === 'private') windows.createWindow({ url, isPrivate: true });
  else {
    const t = win.createTab({ url, background: where === 'background' });
    if (extra.typed || extra.fallbackUrl) t.navigate(url, extra);
  }
}

const chromeApi = {
  ready(win) {
    win.onChromeReady();
    return {
      ...win.getInitialState(),
      settings: chromeSettings(),
      bookmarksBar: bookmarksBar(),
      downloads: downloadsFor(win),
      commands: commands.list(),
      version: app.getVersion(),
    };
  },
  layout(win, insets) {
    win.setInsets(insets);
  },
  raise(win, on) {
    win.setRaised(on);
  },
  focusPage(win) {
    win.focusPage();
  },
  setTitleBarOverlay(win, opts) {
    if (!opts) return;
    if (/^#[0-9a-f]{6}$/i.test(opts.color || '')) win.win.setBackgroundColor(opts.color);
    if (process.platform === 'darwin') return;
    try {
      const o = {};
      if (/^#[0-9a-f]{6,8}$/i.test(opts.color || '')) o.color = opts.color;
      if (/^#[0-9a-f]{6,8}$/i.test(opts.symbolColor || '')) o.symbolColor = opts.symbolColor;
      if (Number.isFinite(opts.height)) o.height = Math.max(24, Math.min(64, Math.round(opts.height)));
      win.win.setTitleBarOverlay(o);
      if (o.color) win.win.setBackgroundColor(o.color);
    } catch {
      /* unsupported */
    }
  },
  windowControl(win, action) {
    if (action === 'minimize') win.win.minimize();
    else if (action === 'maximize') (win.win.isMaximized() ? win.win.unmaximize() : win.win.maximize());
    else if (action === 'close') win.close();
    else if (action === 'fullscreen') win.toggleFullscreen();
  },

  // Tabs
  newTab(win, url) {
    win.createTab(url ? { url } : {});
  },
  closeTab(win, id) {
    const t = win.getTab(id);
    if (t) win.closeTab(t);
  },
  activateTab(win, id) {
    const t = win.getTab(id);
    if (t) win.activateTab(t);
  },
  moveTab(win, id, index) {
    const t = win.getTab(id);
    if (t && Number.isInteger(index)) win.moveTab(t, index);
  },
  tabAction(win, id, action) {
    const t = win.getTab(id);
    if (!t) return;
    switch (action) {
      case 'pin':
        win.togglePin(t);
        break;
      case 'mute':
        t.setMuted(!t.state.muted);
        break;
      case 'duplicate':
        win.duplicateTab(t);
        break;
      case 'reload':
        t.reload();
        break;
      case 'split':
        if (t !== win.activeTab) win.openSplit(win.activeTab, t);
        break;
      case 'newWindow':
        win.moveTabToNewWindow(t);
        break;
      default:
        break;
    }
  },
  switchToTab(win, windowId, tabId) {
    const w = windows.get(windowId);
    const t = w?.getTab(tabId);
    if (!t) return;
    w.activateTab(t);
    w.win.focus();
  },

  // Navigation
  navigate(win, text, where = 'current') {
    const r = resolveInput(String(text || ''), searchOpts());
    if (!r) return false;
    const extra = { typed: true };
    // Scheme-less host typed → https first, fall back to http if unreachable.
    if (r.type === 'url' && /^https:\/\//.test(r.url) && !/^https:\/\//i.test(String(text).trim())) {
      extra.fallbackUrl = `http://${r.url.slice('https://'.length)}`;
    }
    openUrlIn(win, r.url, where, extra);
    return true;
  },
  openUrl(win, url, where = 'current') {
    if (typeof url !== 'string' || !url) return;
    if (/^javascript:/i.test(url)) {
      win.activeTab?.runBookmarklet(url);
      return;
    }
    openUrlIn(win, url, where, { typed: true });
  },
  nav(win, action) {
    const t = win.activeTab;
    if (!t) return;
    if (action === 'back') t.goBack();
    else if (action === 'forward') t.goForward();
    else if (action === 'reload') t.reload();
    else if (action === 'hardReload') t.reload(true);
    else if (action === 'stop') t.stop();
    else if (action === 'home') t.navigate(ctx.settings.get('homepage') || 'lib://newtab/');
  },
  suggest(win, text, allowInline = true) {
    return localSuggestions(String(text || ''), {
      isPrivate: win.isPrivate,
      windowId: win.id,
      currentTabId: win.activeTab?.id,
      allowInline: allowInline !== false,
    });
  },
  suggestRemote(_win, text) {
    return remoteSuggestions(String(text || ''));
  },
  removeHistoryUrl(_win, url) {
    if (typeof url === 'string') ctx.history.deleteUrl(url);
  },
  find(win, text, opts) {
    win.activeTab?.find(String(text || ''), opts || {});
  },
  stopFind(win) {
    win.activeTab?.stopFind('keepSelection');
  },
  zoom(win, dir) {
    win.activeTab?.zoom(dir);
  },
  command(win, id, arg) {
    commands.run(String(id), { win, tab: win.activeTab, arg });
  },
  showMenu(win, name, args = {}) {
    const pos = { x: args.x, y: args.y };
    switch (name) {
      case 'tab':
        menus.showTabContextMenu(win, win.getTab(args.tabId), pos);
        break;
      case 'back':
      case 'forward':
        menus.showNavHistoryMenu(win, name, pos);
        break;
      case 'recentlyClosed':
        menus.showRecentlyClosedMenu(win, pos);
        break;
      case 'bookmarkFolder':
        menus.showBookmarkFolderMenu(win, args.id, pos);
        break;
      case 'bookmarkItem':
        menus.showBookmarkItemMenu(win, args.id, pos);
        break;
      case 'bookmarkBar':
        menus.showBookmarkItemMenu(win, null, pos);
        break;
      case 'omnibox':
        menus.showOmniboxMenu(win, args, pos);
        break;
      default:
        break;
    }
  },

  // Bookmarks
  bookmarkInfo(win) {
    const t = win.activeTab;
    if (!t) return null;
    const node = ctx.bookmarks.findByUrl(t.state.url);
    return {
      bookmarked: Boolean(node),
      id: node?.id || null,
      title: node?.title || t.state.title || t.state.url,
      url: t.state.url,
      parentId: node ? findParentId(node.id) : 'bar',
      folders: ctx.bookmarks.folders(),
      bookmarkable: /^(https?|file):/.test(t.state.url),
    };
  },
  bookmarkSave(win, data = {}) {
    const t = win.activeTab;
    if (!t) return null;
    const title = String(data.title || t.state.title || t.state.url).slice(0, 1024);
    const parentId = ctx.bookmarks.get(data.parentId)?.type === 'folder' ? data.parentId : 'bar';
    if (data.id && ctx.bookmarks.get(data.id)) {
      ctx.bookmarks.update(data.id, { title, url: typeof data.url === 'string' && data.url ? data.url : undefined });
      if (findParentId(data.id) !== parentId) ctx.bookmarks.move(data.id, parentId);
      return data.id;
    }
    return ctx.bookmarks.add({ parentId, title, url: t.state.url }).id;
  },
  bookmarkQuickAdd(win) {
    const t = win.activeTab;
    if (!t || !/^(https?|file):/.test(t.state.url)) return null;
    const existing = ctx.bookmarks.findByUrl(t.state.url);
    if (existing) return existing.id;
    return ctx.bookmarks.add({ parentId: 'bar', title: t.state.title || t.state.url, url: t.state.url }).id;
  },
  bookmarkRemove(win, id) {
    if (id) ctx.bookmarks.remove(id);
    else if (win.activeTab) ctx.bookmarks.removeUrl(win.activeTab.state.url);
  },
  bookmarkGet(_win, id) {
    const node = ctx.bookmarks.get(id);
    if (!node) return null;
    return { id: node.id, type: node.type, title: node.title, url: node.url || '', parentId: findParentId(id), folders: ctx.bookmarks.folders() };
  },
  bookmarkUpdate(_win, id, changes = {}) {
    if (!ctx.bookmarks.get(id)) return;
    ctx.bookmarks.update(id, { title: changes.title, url: changes.url });
    if (changes.parentId && changes.parentId !== findParentId(id)) ctx.bookmarks.move(id, changes.parentId);
  },
  bookmarkMove(_win, id, parentId, index) {
    ctx.bookmarks.move(id, parentId, index);
  },
  addBookmarkFromDrop(_win, url, title, index) {
    if (typeof url !== 'string' || !/^(https?|file):/.test(url)) return;
    ctx.bookmarks.add({ parentId: 'bar', url, title: String(title || url), index });
  },

  // Prompts
  permissionRespond(win, id, allow, remember) {
    if (ctx.permissions.pending.get(id)?.tab.win !== win) return;
    ctx.permissions.respond(id, Boolean(allow), remember !== false);
  },
  authRespond(win, id, creds) {
    win.respondAuth(id, creds);
  },

  // Downloads
  downloads(win) {
    return downloadsFor(win);
  },
  downloadAction(_win, id, action) {
    const d = ctx.downloads;
    if (typeof d[action] === 'function' && ['pause', 'resume', 'cancel', 'open', 'show', 'remove', 'retry'].includes(action)) d[action](String(id));
  },

  // Site info (padlock popup)
  siteInfo(win) {
    const t = win.activeTab;
    if (!t) return null;
    const url = t.state.url;
    const host = hostOf(url);
    const origin = originOf(url);
    const site = host.replace(/^www\./, '');
    const allow = ctx.settings.get('adblockAllowlist') || [];
    const perms = ctx.sitePrefs.store.data.permissions[origin] || {};
    return {
      url,
      host,
      origin,
      security: t.snapshot().security,
      blocked: t.state.blocked,
      adblockEnabled: ctx.settings.get('adblockEnabled'),
      allowlisted: allow.includes(site),
      permissions: Object.entries(perms).map(([key, value]) => ({ key, value, label: PROMPTABLE[key] || key })),
      zoom: t.state.zoom,
      isHttp: /^https?:/.test(url),
    };
  },
  toggleSiteAdblock(win) {
    commands.run('toggleAdblockSite', { win, tab: win.activeTab });
  },
  setSitePermission(win, key, value) {
    const origin = originOf(win.activeTab?.state.url || '');
    if (!origin || !(key in PROMPTABLE)) return;
    ctx.sitePrefs.setPermission(origin, key, value === 'allow' || value === 'block' ? value : null);
  },
  clearSiteData(win) {
    const t = win.activeTab;
    const origin = originOf(t?.state.url || '');
    if (!origin || !/^https?:/.test(origin)) return;
    win.session.clearStorageData({ origin }).then(() => t.reload());
  },

  // Split / devtools
  splitRatio(win, r) {
    win.setSplitRatio(r);
  },
  devtoolsRatio(win, r) {
    win.setDevtoolsRatio(r);
  },
  splitAction(win, action) {
    if (action === 'close') win.closeSplit();
    else if (action === 'swap') win.swapSplit();
    else if (action === 'new') win.splitWith();
  },

  // Misc
  setSetting(_win, key, value) {
    const allowed = ['showBookmarksBar', 'theme', 'verticalTabs', 'compactMode', 'adblockEnabled'];
    if (allowed.includes(key)) ctx.settings.set(key, value);
  },
  copyText(_win, text) {
    if (typeof text === 'string') clipboard.writeText(text.slice(0, 1_000_000));
  },
  paletteSearch(win, query) {
    const q = String(query || '').trim();
    const bookmarks = q ? ctx.bookmarks.search(q, 6).filter((b) => !/^javascript:/i.test(b.url)).map((b) => ({ title: b.title, url: b.url })) : [];
    const history = q ? ctx.history.searchUrls(q, 6).map((h) => ({ title: h.title, url: h.url, favicon: h.favicon })) : [];
    const tabs = windows
      .all()
      .filter((w) => w.isPrivate === win.isPrivate)
      .flatMap((w) => w.tabs.map((t) => ({ windowId: w.id, tabId: t.id, title: t.snapshot().title || 'New Tab', url: t.state.url, favicon: t.state.favicon, active: t === w.activeTab && w === win })));
    return { tabs, bookmarks, history, recentlyClosed: ctx.sessionState.recentlyClosed(5) };
  },
  reopenClosedAt(win, index) {
    const item = ctx.sessionState.takeClosed(index);
    if (item) commands.restoreClosedItem(win, item);
  },
};

function findParentId(id) {
  for (const f of ctx.bookmarks.folders()) {
    const node = ctx.bookmarks.get(f.id);
    if (node.children.some((c) => c.id === id)) return f.id;
  }
  return 'bar';
}

// ---------------------------------------------------------- internal pages API

function rangeToSince(range) {
  const now = Date.now();
  const H = 60 * 60 * 1000;
  return { hour: now - H, day: now - 24 * H, week: now - 7 * 24 * H, month: now - 30 * 24 * H }[range] || 0;
}

async function clearBrowsingData(opts = {}) {
  const since = rangeToSince(opts.range);
  if (opts.history) {
    ctx.history.clear(since);
    if (!since) ctx.sessionState.clearClosed();
  }
  if (opts.downloads) ctx.downloads.clear(since);
  const ses = getBrowsingSession(false);
  if (opts.cookies) {
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache'],
    });
  }
  if (opts.cache) {
    await ses.clearCache();
    await ses.clearCodeCaches({}).catch(() => {});
  }
  if (opts.sitePrefs) ctx.sitePrefs.clearAll();
  return true;
}

function defaultBrowserArgs() {
  // In development the app is launched as `electron <path>`.
  return app.isPackaged ? [] : [process.execPath, [path.resolve(process.argv[1] || '.')]];
}

function taskList() {
  const metrics = app.getAppMetrics();
  const byPid = new Map(metrics.map((m) => [m.pid, m]));
  const rows = [];
  const used = new Set();
  for (const w of windows.all()) {
    for (const t of w.tabs) {
      const wc = t.webContents;
      if (!wc) {
        rows.push({ kind: 'tab', tabId: t.id, title: t.snapshot().title || 'New Tab', url: t.state.url, favicon: t.state.favicon, memory: 0, cpu: 0, pid: null, sleeping: true, isPrivate: w.isPrivate });
        continue;
      }
      const pid = wc.getOSProcessId();
      const m = byPid.get(pid);
      used.add(pid);
      rows.push({
        kind: 'tab',
        tabId: t.id,
        title: t.snapshot().title || 'New Tab',
        url: t.state.url,
        favicon: t.state.favicon,
        memory: m ? m.memory.workingSetSize * 1024 : 0,
        cpu: m ? m.cpu.percentCPUUsage : 0,
        pid,
        isPrivate: w.isPrivate,
      });
    }
  }
  for (const m of metrics) {
    if (used.has(m.pid)) continue;
    const name = m.type === 'Browser' ? 'Browser' : m.type === 'GPU' ? 'GPU process' : m.type === 'Utility' ? `Utility: ${m.serviceName || m.name || 'service'}` : m.type === 'Tab' ? 'Browser interface' : m.type;
    rows.push({ kind: 'process', title: name, memory: m.memory.workingSetSize * 1024, cpu: m.cpu.percentCPUUsage, pid: m.pid });
  }
  return rows;
}

/** @type {Record<string, (tab: any, ...args: any[]) => any>} */
const pageApi = {
  getSettings() {
    return {
      settings: ctx.settings.all(),
      searchEngines: SEARCH_ENGINES.map(({ id, name }) => ({ id, name })),
      keywords: KEYWORDS.map(({ keyword, name, bangOnly }) => ({ keyword, name, bangOnly: Boolean(bangOnly) })),
      accents: ACCENTS,
      platform: process.platform,
      systemDark: nativeTheme.shouldUseDarkColors,
      dark: isDarkTheme(),
    };
  },
  setSetting(_tab, key, value) {
    return ctx.settings.set(String(key), value);
  },
  resetSettings() {
    ctx.settings.reset();
    return true;
  },
  navigate(tab, text) {
    const r = resolveInput(String(text || ''), searchOpts());
    if (r) tab.navigate(r.url, { typed: true });
  },
  openUrl(tab, url, where = 'current') {
    if (typeof url !== 'string' || !/^(https?|file|lib):/i.test(url)) return;
    if (where === 'current') tab.navigate(url);
    else openUrlIn(tab.win, url, where);
  },
  suggest(tab, text) {
    return localSuggestions(String(text || ''), { isPrivate: tab.isPrivate, currentTabId: tab.id });
  },
  suggestRemote(_tab, text) {
    return remoteSuggestions(String(text || ''));
  },
  newtabData(tab) {
    const s = ctx.settings.all();
    const engine = getEngine(s.searchEngine, s.customSearchUrl);
    return {
      topSites: tab.isPrivate ? [] : ctx.history.topSites(8, s.ntpHiddenSites),
      quickLinks: s.ntpQuickLinks,
      blockedTotal: ctx.adblock.totalBlocked,
      blockedSince: ctx.adblock.stats.data.since,
      searchEngineName: engine.name,
      isPrivate: tab.isPrivate,
      settings: {
        ntpShowClock: s.ntpShowClock,
        ntpShowTopSites: s.ntpShowTopSites,
        ntpShowStats: s.ntpShowStats,
        ntpShowGreeting: s.ntpShowGreeting,
        ntpBackground: s.ntpBackground,
        ntpName: s.ntpName,
        adblockEnabled: s.adblockEnabled,
      },
      recentlyClosed: tab.isPrivate ? [] : ctx.sessionState.recentlyClosed(4),
    };
  },
  hideTopSite(_tab, host) {
    const list = ctx.settings.get('ntpHiddenSites') || [];
    if (typeof host === 'string' && !list.includes(host)) ctx.settings.set('ntpHiddenSites', [...list, host].slice(-200));
  },
  addQuickLink(_tab, link) {
    if (!link || typeof link.url !== 'string') return false;
    const r = resolveInput(link.url, searchOpts());
    if (!r || r.type === 'search') return false;
    const list = ctx.settings.get('ntpQuickLinks') || [];
    const title = String(link.title || hostOf(r.url) || r.url).slice(0, 80);
    return ctx.settings.set('ntpQuickLinks', [...list.filter((l) => l.url !== r.url), { title, url: r.url }].slice(0, 24));
  },
  removeQuickLink(_tab, url) {
    const list = ctx.settings.get('ntpQuickLinks') || [];
    return ctx.settings.set('ntpQuickLinks', list.filter((l) => l.url !== url));
  },
  setCustomBackground(_tab, bytes, mime) {
    if (!(bytes instanceof Uint8Array) || bytes.length > 15 * 1024 * 1024) return false;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return false;
    const file = path.join(ctx.userDataPath, 'ntp-background');
    fs.writeFileSync(file, bytes);
    fs.writeFileSync(`${file}.type`, mime);
    ctx.settings.set('ntpCustomBackground', `lib://newtab/_bg/custom?v=${Date.now()}`);
    ctx.settings.set('ntpBackground', 'custom');
    return true;
  },
  reopenClosedAt(tab, index) {
    const item = ctx.sessionState.takeClosed(index);
    if (item) commands.restoreClosedItem(tab.win, item);
  },

  // History
  historyQuery(_tab, q) {
    return ctx.history.query(q || {});
  },
  historyDelete(_tab, ids) {
    if (Array.isArray(ids)) ctx.history.deleteVisits(ids.filter((n) => Number.isInteger(n)));
  },
  historyDeleteUrl(_tab, url) {
    if (typeof url === 'string') ctx.history.deleteUrl(url);
  },

  // Bookmarks
  bookmarksTree() {
    return ctx.bookmarks.tree();
  },
  bookmarksSearch(_tab, q) {
    return ctx.bookmarks.search(String(q || ''), 200);
  },
  bookmarkAdd(_tab, item) {
    return ctx.bookmarks.add(item || {});
  },
  bookmarkUpdate(_tab, id, changes) {
    return ctx.bookmarks.update(id, changes || {});
  },
  bookmarkRemove(_tab, id) {
    return ctx.bookmarks.remove(id);
  },
  bookmarkMove(_tab, id, parentId, index) {
    return ctx.bookmarks.move(id, parentId, index);
  },
  async bookmarksExport(tab) {
    const { canceled, filePath } = await dialog.showSaveDialog(tab.win.win, {
      title: 'Export bookmarks',
      defaultPath: path.join(app.getPath('documents'), `bookmarks_${new Date().toISOString().slice(0, 10)}.html`),
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, ctx.bookmarks.exportHtml());
    return true;
  },
  async bookmarksImport(tab) {
    const { canceled, filePaths } = await dialog.showOpenDialog(tab.win.win, {
      title: 'Import bookmarks (HTML file exported from Chrome, Edge, Firefox or Safari)',
      properties: ['openFile'],
      filters: [{ name: 'Bookmarks HTML', extensions: ['html', 'htm'] }],
    });
    if (canceled || !filePaths[0]) return -1;
    return ctx.bookmarks.importHtml(fs.readFileSync(filePaths[0], 'utf8'));
  },

  // Downloads
  downloadsList(tab) {
    return ctx.downloads.list(tab.isPrivate);
  },
  downloadAction(_tab, id, action) {
    chromeApi.downloadAction(null, id, action);
  },
  downloadsClear() {
    ctx.downloads.clear();
  },
  async chooseDownloadDir(tab) {
    const { canceled, filePaths } = await dialog.showOpenDialog(tab.win.win, {
      title: 'Choose download folder',
      defaultPath: ctx.settings.get('downloadDir'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return null;
    ctx.settings.set('downloadDir', filePaths[0]);
    return filePaths[0];
  },

  // Privacy
  clearBrowsingData(_tab, opts) {
    return clearBrowsingData(opts || {});
  },
  sitePermissions() {
    return ctx.sitePrefs.listPermissions().map((p) => ({
      origin: p.origin,
      perms: Object.entries(p.perms).map(([key, value]) => ({ key, value, label: PROMPTABLE[key] || key })),
    }));
  },
  setSitePermission(_tab, origin, key, value) {
    if (typeof origin !== 'string' || !(key in PROMPTABLE)) return;
    ctx.sitePrefs.setPermission(origin, key, value === 'allow' || value === 'block' ? value : null);
  },
  adblockInfo() {
    return {
      status: ctx.adblock.status,
      updatedAt: ctx.adblock.updatedAt,
      total: ctx.adblock.totalBlocked,
      since: ctx.adblock.stats.data.since,
      allowlist: ctx.settings.get('adblockAllowlist'),
    };
  },
  async adblockUpdate() {
    try {
      await ctx.adblock.update();
      return { ok: true, updatedAt: ctx.adblock.updatedAt };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  },

  // Default browser
  defaultBrowserStatus() {
    return { isDefault: app.isDefaultProtocolClient('https', ...defaultBrowserArgs()), platform: process.platform };
  },
  makeDefaultBrowser() {
    const args = defaultBrowserArgs();
    const ok = app.setAsDefaultProtocolClient('http', ...args) && app.setAsDefaultProtocolClient('https', ...args);
    if (process.platform === 'win32') shell.openExternal('ms-settings:defaultapps').catch(() => {});
    return ok;
  },

  // About
  appInfo() {
    return {
      name: 'LIB Browser',
      version: app.getVersion(),
      chrome: process.versions.chrome,
      electron: process.versions.electron,
      node: process.versions.node,
      v8: process.versions.v8,
      platform: `${process.platform} ${process.arch}`,
      userData: ctx.userDataPath,
      packaged: app.isPackaged,
    };
  },

  // Reader
  readerArticle(_tab, id) {
    return reader.getArticle(String(id || ''));
  },

  shortcuts() {
    return commands.allShortcuts();
  },

  workspaceList(tab) { return tab.isPrivate ? [] : ctx.workspaces.list(); },
  workspaceSave(tab, name) {
    if (tab.isPrivate) throw Error('Workspaces are unavailable in private windows');
    return ctx.workspaces.save(name, tab.win.tabs.map(t => ({ url: t.state.url, title: t.state.title, pinned: t.state.pinned })));
  },
  workspaceRename(tab, id, name) { return !tab.isPrivate && ctx.workspaces.rename(String(id), name); },
  workspaceRemove(tab, id) { return !tab.isPrivate && ctx.workspaces.remove(String(id)); },
  workspaceOpen(tab, id) {
    if (tab.isPrivate) return false;
    const item = ctx.workspaces.get(String(id));
    if (!item || !item.tabs.length) return false;
    const w = windows.createWindow({ empty: true });
    item.tabs.forEach((t, i) => w.createTab({ url: t.url, title: t.title, pinned: t.pinned, background: i > 0, lazy: i > 0 }));
    return true;
  },

  // Task manager
  taskList() {
    return taskList();
  },
  endTask(_tab, tabId) {
    const t = windows.allTabs().find((x) => x.id === tabId);
    const wc = t?.webContents;
    if (wc && !wc.isDestroyed()) wc.forcefullyCrashRenderer();
  },
  focusTab(_tab, tabId) {
    for (const w of windows.all()) {
      const t = w.getTab(tabId);
      if (t) {
        w.activateTab(t);
        w.win.focus();
      }
    }
  },

  runCommand(tab, id) {
    const allowed = ['newTab', 'newWindow', 'newPrivateWindow', 'history', 'downloads', 'bookmarksManager', 'settings', 'reopenClosed', 'shortcuts', 'about', 'clearData', 'toggleTheme'];
    if (allowed.includes(id)) commands.run(id, { win: tab.win, tab });
  },
  finishOnboarding() {
    ctx.settings.set('onboarded', true);
  },
};

// ------------------------------------------------------------------- wiring

function register() {
  ipcMain.handle('lib:chrome', async (event, method, ...args) => {
    const win = windows.findWindowByChromeWebContents(event.sender);
    if (!win || !event.senderFrame || event.senderFrame.parent) throw new Error('Unknown window');
    const fn = apiMethod(chromeApi, method);
    if (typeof fn !== 'function') throw new Error(`Unknown method ${method}`);
    return fn(win, ...args);
  });
  ipcMain.on('lib:chrome-send', (event, method, ...args) => {
    const win = windows.findWindowByChromeWebContents(event.sender);
    const fn = apiMethod(chromeApi, method);
    if (win && event.senderFrame && !event.senderFrame.parent && typeof fn === 'function') {
      try {
        const r = fn(win, ...args);
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (err) {
        console.error(`[ipc] ${method}`, err);
      }
    }
  });

  ipcMain.handle('lib:page', async (event, method, ...args) => {
    const frame = event.senderFrame;
    // Only top-level lib:// documents get the privileged API.
    if (!trustedInternalFrame(frame)) throw new Error('Forbidden');
    const tab = windows.findTabByWebContents(event.sender);
    if (!tab) throw new Error('Unknown tab');
    const fn = apiMethod(pageApi, method);
    if (typeof fn !== 'function') throw new Error(`Unknown method ${method}`);
    return fn(tab, ...args);
  });

  ipcMain.on('lib:unhandled-key', (event, input) => {
    const tab = windows.findTabByWebContents(event.sender);
    if (!tab || !input || typeof input !== 'object') return;
    shortcuts.handleUnhandledKey(tab.win, tab, input);
  });
  ipcMain.on('lib:mouse-nav', (event, direction) => {
    const tab = windows.findTabByWebContents(event.sender);
    if (!tab) return;
    if (direction === 'back') tab.goBack();
    else if (direction === 'forward') tab.goForward();
  });

  // Broadcast state changes.
  const broadcastPages = (name, payload, filter = () => true) => {
    for (const t of windows.allTabs()) {
      const wc = t.webContents;
      if (wc && t.state.url.startsWith('lib://') && filter(t)) wc.send('lib:page-event', name, payload);
    }
  };
  ctx.settings.on('change', (key, value) => {
    if (key === 'theme') {
      nativeTheme.themeSource = value;
      broadcastPages('theme', { dark: isDarkTheme() });
    }
    for (const w of windows.all()) {
      w.sendChrome('settings', chromeSettings());
      if (key === 'adblockEnabled' || key === 'adblockAllowlist') w._scheduleSync();
    }
    if (key === 'spellcheck') {
      for (const ses of [getBrowsingSession(false), getBrowsingSession(true)]) ses.setSpellCheckerEnabled(Boolean(value));
    }
    broadcastPages('settings', { key, value });
  });
  nativeTheme.on('updated', () => {
    for (const w of windows.all()) w.sendChrome('settings', chromeSettings());
    broadcastPages('theme', { dark: isDarkTheme() });
  });
  ctx.bookmarks.on('changed', () => {
    const bar = bookmarksBar();
    for (const w of windows.all()) {
      w.sendChrome('bookmarks-bar', bar);
      w._scheduleSync();
    }
    broadcastPages('bookmarks', null);
  });
  ctx.history.on('changed', () => broadcastPages('history', null, (t) => t.state.url.startsWith('lib://history')));
  ctx.downloads.on('changed', () => {
    let fraction = -1;
    for (const w of windows.all()) {
      const s = downloadsFor(w);
      w.sendChrome('downloads', s);
      if (!w.isPrivate) fraction = s.active ? (s.progress >= 0 ? s.progress : 2) : -1;
    }
    for (const w of windows.all()) {
      try {
        w.win.setProgressBar(fraction);
      } catch {
        /* ignore */
      }
    }
    broadcastPages('downloads', null, (t) => t.state.url.startsWith('lib://downloads'));
  });
  ctx.downloads.on('started', (record, wc) => {
    const tab = wc ? windows.findTabByWebContents(wc) : null;
    const win = tab?.win || windows.getFocusedWindow();
    win?.sendChrome('download-started', { id: record.id, filename: record.filename });
    // A download that opened a blank tab (target=_blank) leaves it empty: close it.
    if (tab && !tab.webContents?.getURL() && tab.win.tabs.length > 1) tab.win.closeTab(tab, { force: true });
  });
}

module.exports = { register, chromeSettings, clearBrowsingData, isDarkTheme };
