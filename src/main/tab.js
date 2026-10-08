'use strict';

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { WebContentsView, dialog, shell } = require('electron');
const ctx = require('./context');
const reader = require('./reader');
const { injectionScript, isCertError } = require('./error-page');
const { hostOf, originOf } = require('./url-utils');

const PAGE_PRELOAD = path.join(__dirname, '..', 'preload', 'page-preload.js');
const { safeExternalLink } = require('./security-policy');
const { boundedHistory } = require('./productivity');
const NEWTAB_URL = 'lib://newtab/';
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

// Errors after which an auto-upgraded (typed, scheme-less) https URL should
// fall back to plain http.
const HTTPS_FALLBACK_ERRORS = new Set([-100, -101, -102, -107, -109, -113, -118, -123, -7, -324]);

let nextTabId = 1;

/** Accepted certificate exceptions for this run: "host|fingerprint". */
const certExceptions = new Set();

/** A view's WebContents, or null once it has been destroyed. */
function liveContents(view) {
  const wc = view?.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}

function isInternal(url) {
  return typeof url === 'string' && url.startsWith('lib://');
}

/**
 * One browser tab: a WebContentsView plus the state the UI renders.
 *
 * A tab may be "discarded" (asleep): its WebContents is destroyed to free
 * memory and recreated — with full back/forward history — on activation.
 */
class Tab extends EventEmitter {
  /**
   * @param {import('./window').BrowserWindowController} win
   * @param {object} opts
   */
  constructor(win, opts = {}) {
    super();
    this.id = nextTabId++;
    this.win = win;
    this.isPrivate = win.isPrivate;
    this.view = null;
    this.devtoolsView = null;
    this.lastActive = Date.now();
    this.openerTabId = opts.openerTabId || null;
    this.savedHistory = opts.history || null;
    this.httpsUpgrade = null;
    this.errorInfo = null;
    this._typed = false;
    this._fallbackUrl = null;
    this._closing = false;
    // Blocked requests seen while a main-frame navigation is in flight; they
    // belong to the incoming page, whose early sub-resources can be blocked
    // before its commit (did-navigate) reaches us.
    this._pendingBlocked = null;
    this.state = {
      url: opts.url || NEWTAB_URL,
      title: opts.title || '',
      favicon: opts.favicon || '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      audible: false,
      muted: Boolean(opts.muted),
      pinned: Boolean(opts.pinned),
      zoom: ctx.settings.get('defaultZoom') || 1,
      discarded: false,
      crashed: false,
      blocked: 0,
      readerable: false,
      errorCode: 0,
      certOverride: false,
      devtools: false,
    };

    if (opts.webContents) {
      // Created by window.open(): adopt the WebContents Chromium made for us so
      // the opener relationship (window.opener, postMessage) keeps working.
      this._createView(opts.webContents, opts.webPreferences);
    } else if (opts.lazy) {
      this.state.discarded = true;
    } else if (this.savedHistory) {
      this.ensureView(); // restores back/forward history (duplicate / reopen)
    } else {
      this._createView();
      this.navigate(this.state.url);
    }
  }

  get webContents() {
    return liveContents(this.view);
  }

  get isActive() {
    return this.win.activeTab === this;
  }

  _webPreferences() {
    return {
      session: this.win.session,
      preload: PAGE_PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      spellcheck: Boolean(ctx.settings.get('spellcheck')),
      plugins: true, // built-in PDF viewer
      navigateOnDragDrop: true,
      scrollBounce: true,
      safeDialogs: true,
      autoplayPolicy: 'user-gesture-required',
    };
  }

  _createView(webContents, webPreferences) {
    const view = webContents
      ? new WebContentsView({ webContents, webPreferences: webPreferences || this._webPreferences() })
      : new WebContentsView({ webPreferences: this._webPreferences() });
    view.setBackgroundColor('#ffffff');
    this.view = view;
    this.state.discarded = false;
    const wc = view.webContents;
    if (this.state.muted) wc.setAudioMuted(true);
    this._wire(wc);
    require('./windows').registerTabWebContents(wc, this);
  }

  /** Make sure the tab has a live WebContents (wakes discarded tabs). */
  ensureView() {
    if (liveContents(this.view)) return;
    this._createView();
    const saved = this.savedHistory;
    this.savedHistory = null;
    const wc = this.view.webContents;
    if (saved && Array.isArray(saved.entries) && saved.entries.length) {
      const index = Math.min(Math.max(0, saved.index ?? saved.entries.length - 1), saved.entries.length - 1);
      wc.navigationHistory.restore({ entries: saved.entries, index }).catch(() => {
        if (!wc.isDestroyed()) wc.loadURL(saved.entries[index]?.url || this.state.url).catch(() => {});
      });
    } else {
      wc.loadURL(this.state.url || NEWTAB_URL).catch(() => {});
    }
    this._emitUpdate();
  }

  // ---------------------------------------------------------------- events

  _wire(wc) {
    wc.setWindowOpenHandler((details) => this._onWindowOpen(details));

    wc.on('did-start-loading', () => {
      this.state.loading = true;
      this.state.crashed = false;
      this._emitUpdate();
    });
    wc.on('did-stop-loading', () => {
      this.state.loading = false;
      if (this._pendingBlocked !== null) {
        // The navigation never committed: the count stays with this page.
        this.state.blocked += this._pendingBlocked;
        this._pendingBlocked = null;
      }
      this._syncNavState();
      this._emitUpdate();
    });
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      // Clearing per-page state happens at commit (did-navigate); here we only
      // need to drop pending permission and sign-in prompts for the old page.
      ctx.permissions.cancelForTab(this);
      this.win.cancelAuthForTab(this);
      this._pendingBlocked = 0;
    });
    wc.on('did-navigate', (_e, url) => {
      // Error pages never emit did-navigate, so reaching here means success.
      this.errorInfo = null;
      this.state.url = url;
      this.state.errorCode = 0;
      this.state.blocked = this._pendingBlocked ?? 0;
      this._pendingBlocked = null;
      this.state.readerable = false;
      this.state.crashed = false;
      this.state.certOverride = [...certExceptions].some((e) => e.startsWith(`${hostOf(url)}|`)) && url.startsWith('https:');
      if (!url.startsWith('https:') || !this.httpsUpgrade || this.httpsUpgrade.to !== url) this.httpsUpgrade = null;
      this.state.title = ''; // the new document's <title> arrives via page-title-updated
      this.state.favicon = '';
      this._syncNavState();
      this._applyZoom(url);
      this._recordVisit(url);
      this._typed = false;
      this._emitUpdate();
      this.win.onTabNavigated(this);
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.state.url = url;
      this._syncNavState();
      this._recordVisit(url);
      this._emitUpdate();
      this.win.onTabNavigated(this);
    });
    wc.on('did-redirect-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this._fallbackUrl = null;
    });
    wc.on('page-title-updated', (_e, title) => {
      this.state.title = title;
      if (!this.isPrivate && !this.errorInfo) ctx.history.updatePage(this.state.url, { title });
      this._emitUpdate();
      this.win.onTabTitle(this);
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      const icon = favicons.find((f) => /^(https?|data|lib):/.test(f)) || '';
      this.state.favicon = icon;
      if (!this.isPrivate && icon && !icon.startsWith('data:')) ctx.history.updatePage(this.state.url, { favicon: icon });
      this._emitUpdate();
    });
    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return; // -3 = ABORTED (user stop / superseded)
      this._onLoadError(errorCode, errorDescription, validatedURL);
    });
    wc.on('did-finish-load', () => {
      this._syncNavState();
      if (/^https?:/.test(this.state.url) && !this.errorInfo) {
        reader.isReaderable(wc).then((ok) => {
          if (this.state.readerable !== ok) {
            this.state.readerable = ok;
            this._emitUpdate();
          }
        });
      }
    });
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      this.state.crashed = true;
      this.state.loading = false;
      this.state.audible = false;
      this._emitUpdate();
      this.win.layout();
    });
    wc.on('unresponsive', () => this.win.onTabUnresponsive?.(this));
    wc.on('audio-state-changed', (e) => {
      this.state.audible = Boolean(e.audible);
      this._emitUpdate();
    });
    wc.on('update-target-url', (_e, url) => {
      if (this.win.isTabVisible(this)) this.win.setStatus(url);
    });
    wc.on('found-in-page', (_e, result) => this.win.onFindResult(this, result));
    wc.on('enter-html-full-screen', () => this.win.setHtmlFullscreen(this, true));
    wc.on('leave-html-full-screen', () => this.win.setHtmlFullscreen(this, false));
    wc.on('zoom-changed', (_e, direction) => this.zoom(direction === 'in' ? 'in' : 'out'));
    wc.on('context-menu', (_e, params) => require('./menus').showPageContextMenu(this, params));
    wc.on('before-input-event', (event, input) => require('./shortcuts').handleInput(this.win, event, input, this));
    wc.on('focus', () => this.win.onTabFocused(this));
    wc.on('devtools-open-url', (_e, url) => this.win.createTab({ url, openerTabId: this.id }));
    wc.on('devtools-closed', () => this.win.onDevToolsClosed(this));
    wc.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(this.win.win, {
        type: 'question',
        buttons: ['Leave', 'Stay'],
        defaultId: 0,
        cancelId: 1,
        title: 'Leave site?',
        message: 'Leave site?',
        detail: 'Changes you made may not be saved.',
      });
      if (choice === 0) event.preventDefault();
      else if (this._vetoClose) this._vetoClose();
    });
    wc.on('will-navigate', (details) => this._onWillNavigate(details));
    wc.on('login', (event, _details, authInfo, callback) => {
      event.preventDefault();
      this.win.requestAuth(this, authInfo, callback);
    });
    wc.on('certificate-error', (event, url, error, certificate, callback, isMainFrame) => {
      const key = `${hostOf(url)}|${certificate.fingerprint}`;
      if (certExceptions.has(key)) {
        event.preventDefault();
        callback(true);
        return;
      }
      if (isMainFrame) this._lastCert = { host: hostOf(url), fingerprint: certificate.fingerprint, error };
      callback(false);
    });
    wc.on('destroyed', () => {
      require('./windows').unregisterTabWebContents(wc);
    });
  }

  _onWindowOpen(details) {
    const { url, disposition, features } = details;
    const current = this.state.url;
    if (isInternal(url) && !isInternal(current)) return { action: 'deny' };
    if (/^javascript:/i.test(url)) return { action: 'deny' };
    if (!/^(https?|about|blob|data|lib|file):/i.test(url)) {
      // mailto:, tel:, zoommtg: … → hand to the OS after confirmation.
      this._openExternal(url);
      return { action: 'deny' };
    }
    const isPopup =
      disposition === 'new-window' && /(^|,)\s*(width|height|popup|left|top)\s*=/.test(features || '');
    if (isPopup) {
      // Real popup windows (OAuth / payment flows) keep window.opener.
      const w = Number((features.match(/width\s*=\s*(\d+)/) || [])[1]) || 520;
      const h = Number((features.match(/height\s*=\s*(\d+)/) || [])[1]) || 640;
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: Math.max(320, Math.min(w, 1600)),
          height: Math.max(240, Math.min(h, 1200)),
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          webPreferences: {
            session: this.win.session,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            plugins: true,
          },
        },
        outlivesOpener: false,
      };
    }
    const background = disposition === 'background-tab';
    const newWindow = disposition === 'new-window';
    // Child WebContents don't inherit the preload; give tabs opened by pages
    // the same preferences as any other tab (session is always the opener's).
    const { session: _s, ...childPrefs } = this._webPreferences();
    return {
      action: 'allow',
      overrideBrowserWindowOptions: { webPreferences: childPrefs },
      createWindow: (options) => {
        const targetWin = newWindow ? require('./windows').createWindow({ isPrivate: this.isPrivate, empty: true }) : this.win;
        const tab = targetWin.createTab({
          webContents: options.webContents,
          webPreferences: options.webPreferences,
          url,
          background: newWindow ? false : background,
          openerTabId: this.id,
          index: newWindow ? undefined : this.win.indexForOpenedTab(this),
        });
        return tab.view.webContents;
      },
    };
  }

  async _openExternal(url) {
    if (!safeExternalLink(url)) { this.win.sendChrome('toast', { message: 'Blocked unsupported external application link' }); return; }
    let scheme = '';
    try {
      scheme = new URL(url).protocol.replace(':', '');
    } catch {
      return;
    }
    const { response } = await dialog.showMessageBox(this.win.win, {
      type: 'question',
      buttons: ['Open', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Open external application?',
      message: `Open ${scheme}: link?`,
      detail: `${hostOf(this.state.url) || 'This page'} wants to open an external application.\n\n${url.slice(0, 300)}`,
    });
    if (response === 0) shell.openExternal(url).catch(() => {});
  }

  _onWillNavigate(details) {
    const url = details.url;
    if (url.startsWith('lib://net-error/')) {
      details.preventDefault();
      if (this.errorInfo) this._handleErrorAction(url.slice('lib://net-error/'.length).split(/[?#]/)[0]);
      return;
    }
    // Web pages may not navigate to privileged internal pages.
    if (isInternal(url) && !isInternal(this.state.url)) {
      details.preventDefault();
      return;
    }
    if (!/^(https?|about|blob|data|lib|file|view-source):/i.test(url) && details.isMainFrame) {
      details.preventDefault();
      this._openExternal(url);
    }
  }

  _handleErrorAction(action) {
    const info = this.errorInfo;
    const wc = this.webContents;
    if (!wc || !info) return;
    switch (action) {
      case 'retry':
        wc.reload();
        break;
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        else wc.loadURL(NEWTAB_URL).catch(() => {});
        break;
      case 'proceed':
        if (isCertError(info.code) && this._lastCert && this._lastCert.host === hostOf(info.url)) {
          certExceptions.add(`${this._lastCert.host}|${this._lastCert.fingerprint}`);
          wc.reload();
        }
        break;
      case 'continue-http':
        if (info.httpsOnlyFallback) {
          const host = hostOf(info.httpsOnlyFallback);
          const list = ctx.settings.get('httpsExceptions') || [];
          if (!list.includes(host)) ctx.settings.set('httpsExceptions', [...list, host]);
          wc.loadURL(info.httpsOnlyFallback).catch(() => {});
        }
        break;
      default:
        break;
    }
  }

  _onLoadError(code, description, url) {
    // Scheme-less input we auto-upgraded to https:// → retry over http://.
    if (this._fallbackUrl && !ctx.settings.get('httpsOnly') && HTTPS_FALLBACK_ERRORS.has(code) && !isCertError(code)) {
      const fallback = this._fallbackUrl;
      this._fallbackUrl = null;
      this.webContents?.loadURL(fallback).catch(() => {});
      return;
    }
    let httpsOnlyFallback = null;
    if (this.httpsUpgrade && url === this.httpsUpgrade.to && (HTTPS_FALLBACK_ERRORS.has(code) || isCertError(code))) {
      httpsOnlyFallback = this.httpsUpgrade.from;
    }
    this.errorInfo = { code, description, url, httpsOnlyFallback };
    this.state.errorCode = code;
    this.state.url = url;
    this.state.blocked = 0;
    this._pendingBlocked = null;
    this.state.readerable = false;
    this.state.title = hostOf(url) || url;
    this.state.loading = false;
    this._syncNavState();
    this._emitUpdate();
    const wc = this.webContents;
    if (wc) {
      const dark = this.isPrivate || require('./ipc').isDarkTheme();
      wc.executeJavaScript(injectionScript(this.errorInfo, dark)).catch(() => {});
    }
  }

  _recordVisit(url) {
    if (this.isPrivate || this.errorInfo) return;
    ctx.history.addVisit({ url, title: this.state.title, typed: this._typed });
  }

  _syncNavState() {
    const wc = this.webContents;
    if (!wc) return;
    this.state.canGoBack = wc.navigationHistory.canGoBack();
    this.state.canGoForward = wc.navigationHistory.canGoForward();
  }

  /** Called by the network layer when a main-frame request starts. */
  onMainFrameRequest() {}

  /** Called by the network layer when a sub-resource was blocked. */
  onRequestBlocked() {
    if (this._pendingBlocked !== null) this._pendingBlocked += 1;
    else this.state.blocked += 1;
    this._emitUpdate();
  }

  _emitUpdate() {
    this.emit('update', this);
  }

  // ------------------------------------------------------------- actions

  /**
   * @param {string} url
   * @param {{ typed?: boolean, fallbackUrl?: string }} [opts]
   */
  navigate(url, opts = {}) {
    if (/^javascript:/i.test(url)) {
      this.runBookmarklet(url);
      return;
    }
    this.ensureView();
    this._typed = Boolean(opts.typed);
    this._fallbackUrl = opts.fallbackUrl || null;
    this.state.url = url;
    this.webContents.loadURL(url).catch(() => {});
    this._emitUpdate();
  }

  runBookmarklet(url) {
    const wc = this.webContents;
    if (!wc) return;
    let code = url.slice('javascript:'.length);
    try {
      code = decodeURIComponent(code);
    } catch {
      /* use raw */
    }
    wc.executeJavaScript(code, true).catch(() => {});
  }

  goBack() {
    const wc = this.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward() {
    const wc = this.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  goToIndex(i) {
    this.webContents?.navigationHistory.goToIndex(i);
  }

  reload(ignoreCache = false) {
    this.ensureView();
    const wc = this.webContents;
    if (!wc) return;
    if (this.state.crashed || !wc.getURL()) {
      wc.loadURL(this.state.url || NEWTAB_URL).catch(() => {});
      return;
    }
    if (ignoreCache) wc.reloadIgnoringCache();
    else wc.reload();
  }

  stop() {
    this.webContents?.stop();
  }

  setMuted(muted) {
    this.state.muted = Boolean(muted);
    this.webContents?.setAudioMuted(this.state.muted);
    this._emitUpdate();
  }

  zoom(direction) {
    const wc = this.webContents;
    if (!wc) return;
    const current = wc.getZoomFactor();
    let next;
    if (direction === 'reset') next = ctx.settings.get('defaultZoom') || 1;
    else if (direction === 'in') next = ZOOM_LEVELS.find((z) => z > current + 0.001) || ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    else next = [...ZOOM_LEVELS].reverse().find((z) => z < current - 0.001) || ZOOM_LEVELS[0];
    wc.setZoomFactor(next);
    this.state.zoom = next;
    const host = hostOf(this.state.url) || this.state.url.split('/')[2];
    if (!this.isPrivate && host) ctx.sitePrefs.setZoom(host, next, ctx.settings.get('defaultZoom') || 1);
    this._emitUpdate();
    this.win.onZoomChanged(this);
  }

  _applyZoom(url) {
    const wc = this.webContents;
    if (!wc) return;
    const host = hostOf(url);
    const z = (host && ctx.sitePrefs.getZoom(host)) || ctx.settings.get('defaultZoom') || 1;
    if (Math.abs(wc.getZoomFactor() - z) > 0.001) wc.setZoomFactor(z);
    this.state.zoom = z;
  }

  find(text, opts = {}) {
    const wc = this.webContents;
    if (!wc) return;
    if (!text) {
      wc.stopFindInPage('clearSelection');
      this.win.onFindResult(this, { matches: 0, activeMatchOrdinal: 0, finalUpdate: true });
      return;
    }
    // Electron's `findNext: true` *starts a new session*; our opts.findNext
    // means "step to the next match of the current search".
    wc.findInPage(text, { forward: opts.forward !== false, findNext: !opts.findNext, matchCase: Boolean(opts.matchCase) });
  }

  stopFind(action = 'keepSelection') {
    this.webContents?.stopFindInPage(action);
  }

  async openReader() {
    const wc = this.webContents;
    if (!wc) return false;
    try {
      const id = await reader.extract(wc);
      if (!id) return false;
      this.navigate(`lib://reader/?id=${id}&url=${encodeURIComponent(this.state.url)}`);
      return true;
    } catch (err) {
      console.error('[reader]', err);
      return false;
    }
  }

  /** Put the tab to sleep to free memory. */
  discard() {
    const wc = this.webContents;
    if (!wc || this.isActive || this.state.audible || this.state.pinned || this.state.loading || this.win.isTabVisible(this) || this.state.devtools) return false;
    try {
      this.savedHistory = boundedHistory(wc.navigationHistory.getAllEntries(), wc.navigationHistory.getActiveIndex());
    } catch {
      this.savedHistory = null;
    }
    this._destroyView();
    this.state.discarded = true;
    this.state.loading = false;
    this._emitUpdate();
    return true;
  }

  _destroyView() {
    const view = this.view;
    if (!view) return;
    this.win.detachView(view);
    this.view = null;
    liveContents(view)?.close();
    this.closeDevTools();
  }

  toggleDevTools() {
    if (this.state.devtools) this.closeDevTools();
    else this.openDevTools();
  }

  openDevTools() {
    const wc = this.webContents;
    if (!wc || this.state.devtools) return;
    // Docked DevTools: render the inspector in our own view next to the page.
    if (!this.win.split) {
      this.devtoolsView = new WebContentsView({ webPreferences: { session: wc.session, nodeIntegration: false, contextIsolation: true, sandbox: true } });
      this.devtoolsView.setBackgroundColor('#ffffff');
      wc.setDevToolsWebContents(this.devtoolsView.webContents);
      wc.openDevTools({ mode: 'detach', activate: true });
    } else {
      wc.openDevTools({ mode: 'detach', activate: true });
    }
    this.state.devtools = true;
    this._emitUpdate();
    this.win._syncViews(); // attach the DevTools view next to the page
  }

  closeDevTools() {
    const wc = this.webContents;
    if (wc && wc.isDevToolsOpened()) wc.closeDevTools();
    if (this.devtoolsView) {
      this.win.detachView(this.devtoolsView);
      liveContents(this.devtoolsView)?.close();
      this.devtoolsView = null;
    }
    if (this.state.devtools) {
      this.state.devtools = false;
      this._emitUpdate();
      if (!this.win.closed) this.win._syncViews();
    }
  }

  inspectElement(x, y) {
    this.openDevTools();
    this.webContents?.inspectElement(x, y);
  }

  /**
   * Close the tab. Runs beforeunload handlers unless `force`.
   * @returns {Promise<boolean>} whether the tab closed
   */
  close(force = false) {
    const wc = this.webContents;
    ctx.permissions.cancelForTab(this);
    if (!wc || force || this.state.crashed) {
      this.destroy();
      return Promise.resolve(true);
    }
    this._closing = true;
    return new Promise((resolve) => {
      const finish = (closed) => {
        clearTimeout(timer);
        wc.removeListener('destroyed', onDestroyed);
        this._vetoClose = null;
        if (!closed) this._closing = false;
        resolve(closed);
      };
      const onDestroyed = () => finish(true);
      wc.once('destroyed', onDestroyed);
      // The user chose "Stay" in the beforeunload dialog.
      this._vetoClose = () => finish(false);
      // A hung page never answers beforeunload: force-close it.
      const timer = setTimeout(() => {
        finish(true);
        this.destroy();
      }, 3000);
      wc.close({ waitForBeforeUnload: true });
    });
  }

  destroy() {
    this._closing = true;
    this._destroyView();
    this.removeAllListeners('update');
  }

  /** Serializable snapshot for the UI. */
  snapshot() {
    const url = this.state.url;
    let security = 'none';
    if (isInternal(url)) security = 'internal';
    else if (this.state.errorCode && isCertError(this.state.errorCode)) security = 'dangerous';
    else if (this.state.errorCode) security = 'none'; // an error page: nothing was loaded securely
    else if (url.startsWith('https:')) security = this.state.certOverride ? 'dangerous' : 'secure';
    else if (url.startsWith('http:')) security = 'insecure';
    else if (url.startsWith('file:')) security = 'file';
    return {
      id: this.id,
      ...this.state,
      title: this.state.title || (isInternal(url) ? '' : url),
      security,
      bookmarked: ctx.bookmarks.isBookmarked(url),
      isReader: url.startsWith('lib://reader'),
      openerTabId: this.openerTabId,
      origin: originOf(url),
    };
  }

  /** For session restore. */
  serialize() {
    let entries = null;
    let index = 0;
    const wc = this.webContents;
    if (wc) {
      try {
        entries = wc.navigationHistory.getAllEntries();
        index = wc.navigationHistory.getActiveIndex();
      } catch {
        entries = null;
      }
    } else if (this.savedHistory) {
      entries = this.savedHistory.entries;
      index = this.savedHistory.index;
    }
    if (entries && entries.length > 25) {
      const drop = entries.length - 25;
      entries = entries.slice(drop);
      index = Math.max(0, index - drop);
    }
    return {
      url: this.state.url,
      title: this.state.title,
      favicon: this.state.favicon,
      pinned: this.state.pinned,
      muted: this.state.muted,
      history: entries ? { entries, index } : null,
    };
  }
}

module.exports = { Tab, NEWTAB_URL, ZOOM_LEVELS, isInternal, liveContents };
