'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { app, ipcMain, net } = require('electron');
const { ElectronBlocker, fromElectronDetails, adsAndTrackingLists } = require('@ghostery/adblocker-electron');
const { JsonStore } = require('./store');
const ctx = require('./context');

// Content script that applies cosmetic (element-hiding) filters in pages.
const PRELOAD_PATH = require.resolve('@ghostery/adblocker-electron-preload');

const REFRESH_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // refresh filter lists every 3 days
const ENGINE_CONFIG = {
  enableCompression: true,
  loadCosmeticFilters: true,
  loadNetworkFilters: true,
  enableMutationObserver: true,
};

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Built-in ad & tracker blocker powered by the Ghostery engine with EasyList,
 * EasyPrivacy and uBlock Origin filter lists.
 *
 * The engine is loaded from (in order): the on-disk cache, the copy bundled
 * with the app, or freshly downloaded lists. Lists refresh in the background.
 */
class AdBlocker extends EventEmitter {
  constructor(userDataPath) {
    super();
    this.dir = path.join(userDataPath, 'adblock');
    this.cacheFile = path.join(this.dir, 'engine.bin');
    this.engine = null;
    this.status = 'loading'; // 'loading' | 'ready' | 'error'
    this.updatedAt = 0;
    this.stats = new JsonStore(path.join(userDataPath, 'adblock-stats.json'), () => ({ total: 0, since: Date.now() }), {
      debounceMs: 5000,
    });
    this._ipcRegistered = false;
    this._sessions = new Set();
  }

  get totalBlocked() {
    return this.stats.data.total;
  }

  /** Is blocking active for a page at `pageUrl`? */
  isActiveFor(pageUrl) {
    if (!this.engine || !ctx.settings.get('adblockEnabled')) return false;
    if (!/^https?:/i.test(pageUrl || '')) return false;
    const host = hostOf(pageUrl).replace(/^www\./, '');
    const allow = ctx.settings.get('adblockAllowlist') || [];
    return !allow.some((h) => host === h || host.endsWith(`.${h}`));
  }

  async init() {
    const testList = process.env.LIB_TEST_ADBLOCK_LIST;
    if (testList) {
      this._setEngine(ElectronBlocker.parse(fs.readFileSync(testList, 'utf8'), ENGINE_CONFIG), Date.now());
      return;
    }
    const cached = this._readEngine(this.cacheFile);
    if (cached) {
      this._setEngine(cached.engine, cached.mtime);
    } else {
      const bundledPath = app.isPackaged
        ? path.join(process.resourcesPath, 'resources', 'adblock-engine.bin')
        : path.join(__dirname, '..', '..', 'resources', 'adblock-engine.bin');
      const bundled = this._readEngine(bundledPath);
      if (bundled) this._setEngine(bundled.engine, bundled.mtime);
    }
    if (!this.engine || Date.now() - this.updatedAt > REFRESH_AFTER_MS) {
      // Don't block startup on the network.
      this.update().catch((err) => console.warn('[adblock] update failed:', err.message));
    }
    const timer = setInterval(() => {
      if (Date.now() - this.updatedAt > REFRESH_AFTER_MS) this.update().catch(() => {});
    }, 6 * 60 * 60 * 1000);
    timer.unref?.();
  }

  _readEngine(file) {
    try {
      const buf = fs.readFileSync(file);
      const engine = ElectronBlocker.deserialize(new Uint8Array(buf));
      Object.assign(engine.config, ENGINE_CONFIG);
      return { engine, mtime: fs.statSync(file).mtimeMs };
    } catch {
      return null;
    }
  }

  _setEngine(engine, updatedAt) {
    this.engine = engine;
    this.updatedAt = updatedAt;
    this.status = 'ready';
    this.emit('ready');
  }

  /** Download the latest filter lists and rebuild the engine. */
  async update() {
    if (this._updating) return this._updating;
    this._updating = (async () => {
      try {
        const fetchImpl = (url) => net.fetch(url, { cache: 'no-store' });
        const engine = await ElectronBlocker.fromLists(fetchImpl, adsAndTrackingLists, ENGINE_CONFIG);
        fs.mkdirSync(this.dir, { recursive: true });
        const tmp = `${this.cacheFile}.tmp`;
        fs.writeFileSync(tmp, engine.serialize());
        fs.renameSync(tmp, this.cacheFile);
        this._setEngine(engine, Date.now());
        return true;
      } catch (err) {
        if (!this.engine) this.status = 'error';
        throw err;
      } finally {
        this._updating = null;
      }
    })();
    return this._updating;
  }

  /**
   * Network hook — called from the request pipeline for every sub-resource.
   * @returns {null | { cancel: true } | { redirectURL: string }}
   */
  match(details, pageUrl) {
    if (!this.isActiveFor(pageUrl)) return null;
    if (details.resourceType === 'mainFrame') return null;
    const request = fromElectronDetails(details);
    if (request.type === 'other') request.guessTypeOfRequest();
    const { redirect, match } = this.engine.match(request);
    if (redirect) return { redirectURL: redirect.dataUrl, blocked: true };
    if (match) return { cancel: true, blocked: true };
    return null;
  }

  /** Header hook — lets filters inject CSP directives into documents. */
  headers(details, pageUrl) {
    if (!this.engine || !ctx.settings.get('adblockEnabled')) return null;
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') return null;
    const url = details.resourceType === 'mainFrame' ? details.url : pageUrl;
    if (!this.isActiveFor(url)) return null;
    const csp = this.engine.getCSPDirectives(fromElectronDetails(details));
    if (!csp) return null;
    const headers = { ...(details.responseHeaders || {}) };
    const policies = csp.split(';').map((p) => p.trim());
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'content-security-policy') {
        policies.push(...headers[name]);
        delete headers[name];
      }
    }
    headers['content-security-policy'] = [policies.join(';')];
    return headers;
  }

  countBlocked(n = 1) {
    this.stats.data.total += n;
    this.stats.save();
  }

  /** Enable cosmetic filtering (element hiding) for a session. */
  attachSession(ses) {
    if (this._sessions.has(ses)) return;
    this._sessions.add(ses);
    ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD_PATH });
    if (!this._ipcRegistered) {
      this._ipcRegistered = true;
      ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', async (event, url, msg) => {
        if (!this.engine) return;
        // Respect the global switch and the per-site allowlist (top-level page).
        const top = event.sender?.getURL?.() || url;
        if (!this.isActiveFor(top)) return;
        return this.engine.onInjectCosmeticFilters(event, url, msg);
      });
      ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', async () => {
        return Boolean(this.engine?.config.enableMutationObserver);
      });
    }
  }

  flush() {
    this.stats.flush();
  }
}

module.exports = { AdBlocker };
