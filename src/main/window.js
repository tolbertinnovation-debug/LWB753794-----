'use strict';

const path = require('node:path');
const { BaseWindow, WebContentsView, nativeTheme, screen, app } = require('electron');
const ctx = require('./context');
const { Tab, NEWTAB_URL, liveContents } = require('./tab');
const { getBrowsingSession, resetPrivateSession } = require('./sessions');

const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'index.html');
const STATUS_HTML = path.join(__dirname, '..', 'renderer', 'status.html');
const CHROME_PRELOAD = path.join(__dirname, '..', 'preload', 'chrome-preload.js');
const ICON = path.join(__dirname, '..', 'renderer', 'icon.png');

const SPLIT_GAP = 6;
const IS_MAC = process.platform === 'darwin';

let nextWindowId = 1;

function isDark() {
  const theme = ctx.settings.get('theme');
  return theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
}

function themeColors(isPrivate) {
  if (isPrivate) return { bg: '#1b1530', fg: '#f1edff' };
  return isDark() ? { bg: '#1d1e23', fg: '#e8e9ee' } : { bg: '#eef0f5', fg: '#1f2330' };
}

/**
 * One browser window: a frameless BaseWindow containing
 *  - the "chrome" view (tab strip, toolbar, popups) spanning the whole window
 *    with a transparent content area, normally at the bottom of the z-order;
 *  - one or two tab views (two in split view) laid over the content area;
 *  - an optional docked DevTools view and a tiny status-bubble view.
 *
 * When a popup (address-bar suggestions, menus, dialogs) opens, the chrome
 * view is "raised" above the tab views; its transparent regions let the page
 * show through, so popups can overlap page content like in any browser.
 */
class BrowserWindowController {
  /**
   * @param {{ isPrivate?: boolean, bounds?: Electron.Rectangle, maximized?: boolean, fullscreen?: boolean }} opts
   */
  constructor(opts = {}) {
    this.id = nextWindowId++;
    this.isPrivate = Boolean(opts.isPrivate);
    this.session = getBrowsingSession(this.isPrivate);
    /** @type {Tab[]} */
    this.tabs = [];
    /** @type {Tab|null} */
    this.activeTab = null;
    this.insets = { top: 84, left: 0, right: 0, bottom: 0 };
    this.raised = false;
    this.split = null; // { tabIds: [a, b], ratio }
    this.devtoolsRatio = 0.42;
    this.htmlFullscreenTab = null;
    this.attached = new Set();
    this.permissionPrompts = new Map(); // id -> prompt
    this.authRequests = new Map(); // id -> { tab, callback }
    this.chromeReady = false;
    this._queue = [];
    this._syncTimer = null;
    this._statusTimer = null;
    this.statusView = null;
    this.statusVisible = false;
    this.closed = false;

    const colors = themeColors(this.isPrivate);
    const bounds = opts.bounds || this._defaultBounds();
    this.win = new BaseWindow({
      ...bounds,
      minWidth: 420,
      minHeight: 320,
      show: false,
      title: 'LIB Browser',
      backgroundColor: colors.bg,
      titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
      ...(IS_MAC
        ? { trafficLightPosition: { x: 14, y: 13 } }
        : { titleBarOverlay: { color: colors.bg, symbolColor: colors.fg, height: 40 } }),
      ...(process.platform === 'linux' ? { icon: ICON } : {}),
    });

    this.chromeView = new WebContentsView({
      webPreferences: {
        preload: CHROME_PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    this.chromeView.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.chromeView);
    const cwc = this.chromeView.webContents;
    cwc.loadFile(RENDERER_HTML, {
      query: { windowId: String(this.id), private: this.isPrivate ? '1' : '0', platform: process.platform },
    });
    cwc.on('before-input-event', (event, input) => require('./shortcuts').handleInput(this, event, input, null));
    cwc.on('render-process-gone', (_e, details) => {
      if (this.closed || details.reason === 'clean-exit') return;
      // The browser UI crashed: reload it; tabs are unaffected.
      this.chromeReady = false;
      cwc.reload();
    });
    // The UI never navigates anywhere.
    cwc.on('will-navigate', (e) => e.preventDefault());
    cwc.on('context-menu', (_e, params) => require('./menus').showUiEditMenu(this, params));
    cwc.setWindowOpenHandler(() => ({ action: 'deny' }));
    if (process.env.LIB_DEVTOOLS === '1') cwc.openDevTools({ mode: 'detach' });

    // Show as soon as the UI has painted (or after a short timeout).
    const show = () => {
      if (this.closed || this.win.isVisible()) return;
      if (opts.maximized) this.win.maximize();
      if (opts.fullscreen) this.win.setFullScreen(true);
      if (opts.inactive) this.win.showInactive();
      else this.win.show();
    };
    cwc.once('did-finish-load', show);
    setTimeout(show, 1500);

    // The content view reports its final size after every resize (the
    // window 'resize' event can fire before the new size is applied on X11).
    this.win.contentView.on('bounds-changed', () => this.layout());
    this.win.on('resize', () => this.layout());
    this.win.on('maximize', () => this._sendWindowState());
    this.win.on('unmaximize', () => this._sendWindowState());
    this.win.on('enter-full-screen', () => {
      this._sendWindowState();
      this.layout();
    });
    this.win.on('leave-full-screen', () => {
      this._sendWindowState();
      this.layout();
    });
    this.win.on('focus', () => {
      require('./windows').setLastFocused(this);
      this.sendChrome('window-focus', true);
    });
    this.win.on('blur', () => this.sendChrome('window-focus', false));
    this.win.on('close', () => this._onClose());
    this.win.on('closed', () => this._onClosed());
    this.win.on('moved', () => ctx.sessionState?.scheduleSave());
    this.layout();
  }

  _defaultBounds() {
    const display = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1360, Math.round(display.width * 0.85));
    const height = Math.min(880, Math.round(display.height * 0.88));
    const focused = require('./windows').getFocusedWindow();
    if (focused && !focused.win.isDestroyed() && !focused.win.isMaximized()) {
      const b = focused.win.getBounds();
      return { x: b.x + 28, y: b.y + 28, width: b.width, height: b.height };
    }
    return {
      x: display.x + Math.round((display.width - width) / 2),
      y: display.y + Math.round((display.height - height) / 2),
      width,
      height,
    };
  }

  // ------------------------------------------------------------ messaging

  sendChrome(event, payload) {
    if (this.closed) return;
    if (!this.chromeReady) {
      this._queue.push([event, payload]);
      return;
    }
    const wc = this.chromeView.webContents;
    if (!wc.isDestroyed()) wc.send('lib:event', event, payload);
  }

  onChromeReady() {
    this.chromeReady = true;
    const queue = this._queue;
    this._queue = [];
    this.sendChrome('tabs', this._tabsPayload());
    for (const [event, payload] of queue) if (event !== 'tabs') this.sendChrome(event, payload);
    const prompts = this.activeTab ? [...this.permissionPrompts.values()].filter((p) => p.tabId === this.activeTab.id) : [];
    if (prompts.length) this.sendChrome('permission-prompts', prompts);
  }

  _sendWindowState() {
    this.sendChrome('window-state', {
      maximized: this.win.isMaximized(),
      fullscreen: this.win.isFullScreen(),
    });
  }

  /** Initial state requested by the UI on load. */
  getInitialState() {
    return {
      windowId: this.id,
      isPrivate: this.isPrivate,
      platform: process.platform,
      maximized: this.win.isMaximized(),
      fullscreen: this.win.isFullScreen(),
      ...this._tabsPayload(),
    };
  }

  _tabsPayload() {
    return {
      tabs: this.tabs.map((t) => t.snapshot()),
      activeId: this.activeTab ? this.activeTab.id : null,
      split: this.split ? { ...this.split } : null,
    };
  }

  _scheduleSync() {
    if (this._syncTimer) return;
    this._syncTimer = setTimeout(() => {
      this._syncTimer = null;
      if (this.closed) return;
      this.sendChrome('tabs', this._tabsPayload());
      this._updateTitle();
    }, 16);
  }

  _updateTitle() {
    const t = this.activeTab;
    const title = t ? t.snapshot().title || 'New Tab' : 'LIB Browser';
    if (!this.win.isDestroyed()) this.win.setTitle(`${title} — LIB Browser${this.isPrivate ? ' (Private)' : ''}`);
  }

  // --------------------------------------------------------------- layout

  /** Visible tabs: the active tab, or both halves of a split pair. */
  visibleTabs() {
    if (this.htmlFullscreenTab && this.tabs.includes(this.htmlFullscreenTab)) return [this.htmlFullscreenTab];
    if (this.split && this.activeTab && this.split.tabIds.includes(this.activeTab.id)) {
      const pair = this.split.tabIds.map((id) => this.tabs.find((t) => t.id === id)).filter(Boolean);
      if (pair.length === 2) return pair;
    }
    return this.activeTab ? [this.activeTab] : [];
  }

  isTabVisible(tab) {
    return this.visibleTabs().includes(tab);
  }

  setInsets(insets) {
    const clean = {};
    for (const k of ['top', 'left', 'right', 'bottom']) clean[k] = Math.max(0, Math.round(Number(insets?.[k]) || 0));
    this.insets = clean;
    this.layout();
  }

  /** Attach/detach views so exactly the visible tabs are in the window. */
  _syncViews() {
    if (this.closed || this.win.isDestroyed()) return;
    const want = new Set();
    for (const tab of this.visibleTabs()) {
      tab.ensureView();
      if (tab.view && !tab.state.crashed) want.add(tab.view);
      if (tab.devtoolsView && !this.htmlFullscreenTab) want.add(tab.devtoolsView);
    }
    const cv = this.win.contentView;
    for (const view of [...this.attached]) {
      if (!want.has(view)) {
        try {
          cv.removeChildView(view);
        } catch {
          /* already gone */
        }
        this.attached.delete(view);
      }
    }
    for (const view of want) {
      if (!this.attached.has(view)) {
        cv.addChildView(view);
        this.attached.add(view);
      }
    }
    this._restack();
    this.layout();
  }

  detachView(view) {
    // Once the native window is gone its views are torn down with it; touching
    // them again is unsafe.
    if (this.closed || this.win.isDestroyed()) {
      this.attached.delete(view);
      return;
    }
    if (this.attached.has(view)) {
      try {
        this.win.contentView.removeChildView(view);
      } catch {
        /* ignore */
      }
      this.attached.delete(view);
    }
  }

  _restack() {
    if (this.closed || this.win.isDestroyed()) return;
    const cv = this.win.contentView;
    if (!this.raised) cv.addChildView(this.chromeView, 0);
    if (this.statusView && this.statusVisible && !this.htmlFullscreenTab) cv.addChildView(this.statusView);
    if (this.raised) cv.addChildView(this.chromeView);
  }

  setRaised(raised) {
    raised = Boolean(raised);
    if (this.raised === raised) return;
    this.raised = raised;
    this._restack();
  }

  layout() {
    if (this.closed || this.win.isDestroyed()) return;
    const { width, height } = this.win.getContentBounds();
    this.chromeView.setBounds({ x: 0, y: 0, width, height });
    const fsTab = this.htmlFullscreenTab;
    if (fsTab && fsTab.view) {
      fsTab.view.setBounds({ x: 0, y: 0, width, height });
      fsTab.view.setBorderRadius(0);
      return;
    }
    // Vertical-tabs layout floats the page as a rounded card.
    const radius = ctx.settings.get('verticalTabs') ? 10 : 0;
    const ins = this.insets;
    const area = {
      x: ins.left,
      y: ins.top,
      width: Math.max(0, width - ins.left - ins.right),
      height: Math.max(0, height - ins.top - ins.bottom),
    };
    const visible = this.visibleTabs();
    const panes = [];
    let divider = null;
    if (visible.length === 2) {
      const ratio = this.split.ratio;
      const leftW = Math.round((area.width - SPLIT_GAP) * ratio);
      panes.push({ x: area.x, y: area.y, width: leftW, height: area.height });
      panes.push({ x: area.x + leftW + SPLIT_GAP, y: area.y, width: area.width - leftW - SPLIT_GAP, height: area.height });
      divider = { x: area.x + leftW, y: area.y, width: SPLIT_GAP, height: area.height, kind: 'split' };
    } else {
      panes.push(area);
    }
    const layoutInfo = { panes: [], divider, devtools: null };
    visible.forEach((tab, i) => {
      let rect = panes[i];
      if (tab.devtoolsView && visible.length === 1) {
        const side = rect.width >= 900 ? 'right' : 'bottom';
        if (side === 'right') {
          const dw = Math.round(rect.width * this.devtoolsRatio);
          const pageW = rect.width - dw - SPLIT_GAP;
          tab.devtoolsView.setBounds({ x: rect.x + pageW + SPLIT_GAP, y: rect.y, width: dw, height: rect.height });
          layoutInfo.devtools = { x: rect.x + pageW, y: rect.y, width: SPLIT_GAP, height: rect.height, side };
          rect = { ...rect, width: pageW };
        } else {
          const dh = Math.round(rect.height * this.devtoolsRatio);
          const pageH = rect.height - dh - SPLIT_GAP;
          tab.devtoolsView.setBounds({ x: rect.x, y: rect.y + pageH + SPLIT_GAP, width: rect.width, height: dh });
          layoutInfo.devtools = { x: rect.x, y: rect.y + pageH, width: rect.width, height: SPLIT_GAP, side };
          rect = { ...rect, height: pageH };
        }
      }
      if (tab.view) {
        tab.view.setBounds(rect);
        tab.view.setBorderRadius(radius);
      }
      layoutInfo.panes.push({ tabId: tab.id, ...rect, crashed: tab.state.crashed });
    });
    this._layoutInfo = layoutInfo;
    this._positionStatus();
    this.sendChrome('layout', layoutInfo);
  }

  // --------------------------------------------------------------- status

  setStatus(url) {
    clearTimeout(this._statusTimer);
    if (!url) {
      this._statusTimer = setTimeout(() => this._showStatus(''), 120);
      return;
    }
    this._showStatus(url);
  }

  _showStatus(text) {
    if (this.closed) return;
    if (!text) {
      if (this.statusView && this.statusVisible) {
        this.statusVisible = false;
        this.statusView.setVisible(false);
      }
      return;
    }
    if (!this.statusView) {
      this.statusView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, javascript: true } });
      this.statusView.setBackgroundColor('#00000000');
      this.statusView.webContents.loadFile(STATUS_HTML);
      this.statusView.webContents.setIgnoreMenuShortcuts(true);
    }
    let display = text;
    try {
      display = decodeURI(text);
    } catch {
      /* keep */
    }
    const wc = this.statusView.webContents;
    const run = () => wc.executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(display.slice(0, 2000))}, ${isDark() || this.isPrivate})`).catch(() => {});
    if (wc.isLoading()) wc.once('did-finish-load', run);
    else run();
    if (!this.statusVisible) {
      this.statusVisible = true;
      this.statusView.setVisible(true);
      this._positionStatus();
      this._restack();
    }
  }

  _positionStatus() {
    if (!this.statusView || !this.statusVisible || !this._layoutInfo) return;
    const pane = this._layoutInfo.panes.find((p) => p.tabId === this.activeTab?.id) || this._layoutInfo.panes[0];
    if (!pane) return;
    const h = 26;
    this.statusView.setBounds({
      x: pane.x,
      y: pane.y + pane.height - h,
      width: Math.max(120, Math.min(Math.round(pane.width * 0.62), 760)),
      height: h,
    });
  }

  // ----------------------------------------------------------------- tabs

  /**
   * @param {object} opts see Tab constructor; plus `background`, `index`
   * @returns {Tab}
   */
  createTab(opts = {}) {
    const url = opts.url || NEWTAB_URL;
    const tab = new Tab(this, { ...opts, url });
    tab.on('update', () => this._onTabUpdate(tab));
    let index = typeof opts.index === 'number' ? opts.index : this.tabs.length;
    const pinnedCount = this.tabs.filter((t) => t.state.pinned).length;
    index = tab.state.pinned ? Math.min(index, pinnedCount) : Math.max(index, pinnedCount);
    index = Math.max(0, Math.min(index, this.tabs.length));
    this.tabs.splice(index, 0, tab);
    if (!opts.noActivate && (!opts.background || !this.activeTab)) {
      this.activateTab(tab, { focusOmnibox: !opts.webContents && url === NEWTAB_URL });
    }
    else this._scheduleSync();
    this._sessionChanged();
    return tab;
  }

  /** Move an existing Tab object (from another window) into this window. */
  adoptTab(tab, index = this.tabs.length) {
    tab.win = this;
    tab.removeAllListeners('update');
    tab.on('update', () => this._onTabUpdate(tab));
    this.tabs.splice(Math.max(0, Math.min(index, this.tabs.length)), 0, tab);
    this.activateTab(tab);
    this._sessionChanged();
  }

  _onTabUpdate(tab) {
    this._scheduleSync();
    if (tab.state.crashed && this.isTabVisible(tab)) this._syncViews();
  }

  indexForOpenedTab(opener) {
    let i = this.tabs.indexOf(opener) + 1;
    while (i < this.tabs.length && this.tabs[i].openerTabId === opener.id) i++;
    return i;
  }

  getTab(id) {
    return this.tabs.find((t) => t.id === id) || null;
  }

  activateTab(tab, { focusOmnibox = false } = {}) {
    if (!tab || !this.tabs.includes(tab)) return;
    const prev = this.activeTab;
    if (prev && prev !== tab) {
      prev.lastActive = Date.now();
      prev.stopFind('clearSelection');
    }
    this.activeTab = tab;
    tab.lastActive = Date.now();
    this._syncViews();
    this._scheduleSync();
    this.setStatus('');
    // Show permission prompts belonging to this tab.
    this.sendChrome(
      'permission-prompts',
      [...this.permissionPrompts.values()].filter((p) => p.tabId === tab.id),
    );
    if (tab.state.url === NEWTAB_URL && (focusOmnibox || !tab.webContents?.getURL())) {
      this.focusOmnibox();
    } else if (!this.raised) {
      tab.webContents?.focus();
    }
    this._sessionChanged();
  }

  async closeTab(tab, { force = false } = {}) {
    if (!tab || !this.tabs.includes(tab) || tab._closePending) return;
    tab._closePending = true;
    // Capture back/forward history now: it's gone once the page is destroyed.
    const snapshot = tab.serialize();
    const closed = await tab.close(force);
    tab._closePending = false;
    if (!closed) return;
    this._removeTab(tab, { snapshot });
  }

  _removeTab(tab, { keepAlive = false, snapshot = null } = {}) {
    const index = this.tabs.indexOf(tab);
    if (index < 0) return;
    if (!keepAlive && !this.isPrivate) ctx.sessionState?.pushClosedTab(snapshot || tab.serialize(), index, this.id);
    this.tabs.splice(index, 1);
    for (const [id, req] of this.authRequests) {
      if (req.tab === tab) {
        this.authRequests.delete(id);
        req.callback();
        this.sendChrome('auth-cancel', { id });
      }
    }
    if (this.split && this.split.tabIds.includes(tab.id)) this.split = null;
    if (this.htmlFullscreenTab === tab) this.setHtmlFullscreen(tab, false);
    if (keepAlive) {
      if (tab.view) this.detachView(tab.view);
      if (tab.devtoolsView) this.detachView(tab.devtoolsView);
    } else {
      tab.destroy();
    }
    if (this.activeTab === tab) {
      this.activeTab = null;
      // Like Chrome: a tab opened from another returns to a sibling from the
      // same opener, then to the opener itself; otherwise the right neighbour.
      const right = this.tabs[index];
      const left = this.tabs[index - 1];
      const opener = tab.openerTabId ? this.tabs.find((t) => t.id === tab.openerTabId) : null;
      let next = right || left;
      if (opener) next = right && right.openerTabId === tab.openerTabId ? right : opener;
      if (next) this.activateTab(next);
    }
    if (!this.tabs.length) {
      if (ctx.settings.get('closeWindowWithLastTab') || keepAlive) this.close();
      else this.createTab();
      return;
    }
    this._syncViews();
    this._scheduleSync();
    this._sessionChanged();
  }

  closeOtherTabs(keep) {
    for (const t of [...this.tabs]) if (t !== keep && !t.state.pinned) this.closeTab(t, { force: true });
  }

  closeTabsToRight(tab) {
    const i = this.tabs.indexOf(tab);
    for (const t of this.tabs.slice(i + 1)) this.closeTab(t, { force: true });
  }

  moveTab(tab, toIndex) {
    const from = this.tabs.indexOf(tab);
    if (from < 0) return;
    this.tabs.splice(from, 1);
    const pinnedCount = this.tabs.filter((t) => t.state.pinned).length;
    let i = Math.max(0, Math.min(toIndex, this.tabs.length));
    i = tab.state.pinned ? Math.min(i, pinnedCount) : Math.max(i, pinnedCount);
    this.tabs.splice(i, 0, tab);
    this._scheduleSync();
    this._sessionChanged();
  }

  togglePin(tab) {
    tab.state.pinned = !tab.state.pinned;
    const from = this.tabs.indexOf(tab);
    this.tabs.splice(from, 1);
    const pinnedCount = this.tabs.filter((t) => t.state.pinned).length;
    this.tabs.splice(pinnedCount, 0, tab);
    this._scheduleSync();
    this._sessionChanged();
  }

  duplicateTab(tab) {
    const data = tab.serialize();
    return this.createTab({
      url: data.url,
      title: data.title,
      favicon: data.favicon,
      history: data.history,
      index: this.tabs.indexOf(tab) + 1,
    });
  }

  moveTabToNewWindow(tab) {
    if (this.tabs.length < 2) return;
    this._removeTab(tab, { keepAlive: true });
    const w = require('./windows').createWindow({ isPrivate: this.isPrivate, empty: true });
    w.adoptTab(tab);
  }

  selectTabAt(i) {
    const tab = i === -1 ? this.tabs[this.tabs.length - 1] : this.tabs[i];
    if (tab) this.activateTab(tab);
  }

  cycleTab(delta) {
    if (!this.tabs.length) return;
    const i = this.tabs.indexOf(this.activeTab);
    this.activateTab(this.tabs[(i + delta + this.tabs.length) % this.tabs.length]);
  }

  // ----------------------------------------------------------- split view

  openSplit(tabA, tabB) {
    if (!tabA || !tabB || tabA === tabB) return;
    for (const t of [tabA, tabB]) if (t.devtoolsView) t.closeDevTools();
    this.split = { tabIds: [tabA.id, tabB.id], ratio: 0.5 };
    this.activeTab = tabB;
    this._syncViews();
    this._scheduleSync();
    tabB.webContents?.focus();
  }

  /** Split the active tab with a new tab (or `other`). */
  splitWith(other) {
    const a = this.activeTab;
    if (!a) return;
    const b = other || this.createTab({ index: this.tabs.indexOf(a) + 1, background: true });
    this.openSplit(a, b);
    if (!other) this.focusOmnibox();
  }

  closeSplit() {
    if (!this.split) return;
    this.split = null;
    this._syncViews();
    this._scheduleSync();
  }

  swapSplit() {
    if (!this.split) return;
    this.split.tabIds.reverse();
    this.layout();
    this._scheduleSync();
  }

  setSplitRatio(ratio) {
    if (!this.split) return;
    this.split.ratio = Math.max(0.15, Math.min(0.85, Number(ratio) || 0.5));
    this.layout();
  }

  setDevtoolsRatio(ratio) {
    this.devtoolsRatio = Math.max(0.15, Math.min(0.85, Number(ratio) || 0.4));
    this.layout();
  }

  onTabFocused(tab) {
    // Clicking into the other half of a split makes it the active tab.
    if (this.split && this.activeTab !== tab && this.split.tabIds.includes(tab.id) && this.isTabVisible(tab)) {
      this.activeTab = tab;
      this._scheduleSync();
    }
  }

  onDevToolsClosed(tab) {
    if (tab.devtoolsView || tab.state.devtools) tab.closeDevTools();
    this._syncViews();
  }

  // ---------------------------------------------------------- tab callbacks

  onTabNavigated(tab) {
    if (tab === this.activeTab) this.sendChrome('tab-navigated', { tabId: tab.id });
    this._sessionChanged();
  }

  onTabTitle(tab) {
    if (tab === this.activeTab) this._updateTitle();
  }

  onZoomChanged(tab) {
    if (tab === this.activeTab) this.sendChrome('zoom', { tabId: tab.id, zoom: tab.state.zoom });
  }

  onFindResult(tab, result) {
    if (tab === this.activeTab) this.sendChrome('find-result', result);
  }

  setHtmlFullscreen(tab, on) {
    if (on) {
      this.htmlFullscreenTab = tab;
      this._wasFullScreen = this.win.isFullScreen();
      if (!this._wasFullScreen) this.win.setFullScreen(true);
    } else if (this.htmlFullscreenTab === tab) {
      this.htmlFullscreenTab = null;
      if (!this._wasFullScreen && !this.win.isDestroyed()) this.win.setFullScreen(false);
    }
    this.sendChrome('html-fullscreen', Boolean(this.htmlFullscreenTab));
    this._syncViews();
  }

  // ------------------------------------------------------------- prompts

  showPermissionPrompt(prompt) {
    this.permissionPrompts.set(prompt.id, prompt);
    if (this.activeTab && prompt.tabId === this.activeTab.id) {
      this.sendChrome('permission-prompts', [...this.permissionPrompts.values()].filter((p) => p.tabId === prompt.tabId));
    }
  }

  hidePermissionPrompt(id) {
    if (!this.permissionPrompts.delete(id)) return;
    const tabId = this.activeTab?.id;
    this.sendChrome('permission-prompts', [...this.permissionPrompts.values()].filter((p) => p.tabId === tabId));
  }

  requestAuth(tab, authInfo, callback) {
    const id = `${this.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.authRequests.set(id, { tab, callback });
    if (!this.isTabVisible(tab)) this.activateTab(tab);
    this.chromeView.webContents.focus();
    this.sendChrome('auth-request', {
      id,
      host: authInfo.host,
      port: authInfo.port,
      realm: authInfo.realm,
      isProxy: authInfo.isProxy,
      scheme: authInfo.scheme,
    });
  }

  respondAuth(id, credentials) {
    const req = this.authRequests.get(id);
    if (!req) return;
    this.authRequests.delete(id);
    if (credentials && typeof credentials.username === 'string') {
      req.callback(credentials.username, String(credentials.password || ''));
    } else {
      req.callback();
    }
  }

  // --------------------------------------------------------------- focus

  focusOmnibox(opts = {}) {
    if (this.closed) return;
    this.chromeView.webContents.focus();
    this.sendChrome('focus-omnibox', opts);
  }

  focusPage() {
    const wc = this.activeTab?.webContents;
    if (wc) wc.focus();
  }

  toggleFullscreen() {
    this.win.setFullScreen(!this.win.isFullScreen());
  }

  // ------------------------------------------------------------- lifecycle

  _sessionChanged() {
    if (!this.isPrivate) ctx.sessionState?.scheduleSave();
  }

  serialize() {
    const normal = this.win.isMaximized() || this.win.isFullScreen() ? this.win.getNormalBounds() : this.win.getBounds();
    return {
      bounds: normal,
      maximized: this.win.isMaximized(),
      fullscreen: this.win.isFullScreen() && !this.htmlFullscreenTab,
      activeIndex: Math.max(0, this.tabs.indexOf(this.activeTab)),
      tabs: this.tabs.map((t) => t.serialize()),
    };
  }

  close() {
    if (!this.closed && !this.win.isDestroyed()) this.win.close();
  }

  _onClose() {
    if (this.isPrivate || ctx.quitting || !this.tabs.length) return;
    ctx.sessionState?.pushClosedWindow(this.serialize());
    const others = require('./windows')
      .all()
      .filter((w) => w !== this && !w.isPrivate && !w.closed);
    // Closing the last window: keep it as the session to restore next launch.
    if (!others.length) ctx.sessionState?.freeze();
  }

  _onClosed() {
    this.closed = true;
    clearTimeout(this._syncTimer);
    for (const tab of this.tabs) {
      ctx.permissions.cancelForTab(tab);
      tab.destroy();
    }
    for (const req of this.authRequests.values()) req.callback();
    this.authRequests.clear();
    this.tabs = [];
    for (const view of [this.chromeView, this.statusView]) {
      liveContents(view)?.close();
    }
    const windows = require('./windows');
    windows.unregister(this);
    if (this.isPrivate && !windows.all().some((w) => w.isPrivate)) resetPrivateSession();
    if (!ctx.quitting) ctx.sessionState?.scheduleSave();
    if (!windows.all().length && process.platform !== 'darwin') app.quit();
  }
}

module.exports = { BrowserWindowController, isDark, themeColors };
