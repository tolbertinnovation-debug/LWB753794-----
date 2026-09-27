'use strict';

const { BrowserWindowController } = require('./window');

/** @type {Map<number, BrowserWindowController>} */
const windows = new Map();
/** webContents.id → Tab, for fast lookups from network/permission callbacks. */
const tabByWebContentsId = new Map();
let lastFocused = null;

/**
 * @param {{ isPrivate?: boolean, url?: string, urls?: string[], empty?: boolean, bounds?: object,
 *           maximized?: boolean, fullscreen?: boolean, tabs?: object[], activeIndex?: number }} opts
 */
function createWindow(opts = {}) {
  if (!opts.isPrivate) require('./context').sessionState?.unfreeze();
  const w = new BrowserWindowController(opts);
  windows.set(w.id, w);
  lastFocused = w;
  if (Array.isArray(opts.tabs) && opts.tabs.length) {
    const active = Math.min(Math.max(0, opts.activeIndex || 0), opts.tabs.length - 1);
    opts.tabs.forEach((t, i) => {
      w.createTab({
        url: t.url,
        title: t.title,
        favicon: t.favicon,
        pinned: t.pinned,
        muted: t.muted,
        history: t.history,
        lazy: i !== active, // only the active tab loads now; others wake on demand
        background: true,
        noActivate: true,
      });
    });
    w.activateTab(w.tabs[active]);
  } else if (!opts.empty) {
    const urls = opts.urls && opts.urls.length ? opts.urls : [opts.url || undefined];
    urls.forEach((url, i) => w.createTab({ url, background: i > 0 }));
  }
  return w;
}

function unregister(w) {
  windows.delete(w.id);
  if (lastFocused === w) lastFocused = [...windows.values()].pop() || null;
}

function setLastFocused(w) {
  lastFocused = w;
}

function getFocusedWindow() {
  if (lastFocused && !lastFocused.closed) return lastFocused;
  return [...windows.values()].pop() || null;
}

/** Last focused normal (or private) window. */
function getWindowOfKind(isPrivate) {
  if (lastFocused && !lastFocused.closed && lastFocused.isPrivate === isPrivate) return lastFocused;
  return [...windows.values()].reverse().find((w) => w.isPrivate === isPrivate) || null;
}

function all() {
  return [...windows.values()];
}

function get(id) {
  return windows.get(id) || null;
}

function registerTabWebContents(wc, tab) {
  tabByWebContentsId.set(wc.id, tab);
}

function unregisterTabWebContents(wc) {
  const id = wc.id;
  // Only remove if still pointing at a tab whose view is this wc.
  tabByWebContentsId.delete(id);
}

function findTabByWebContentsId(id) {
  return tabByWebContentsId.get(id) || null;
}

function findTabByWebContents(wc) {
  if (!wc) return null;
  const tab = tabByWebContentsId.get(wc.id);
  if (tab) return tab;
  // DevTools or a popup opened by a tab: fall back to its opener/host.
  const host = wc.hostWebContents || wc.devToolsWebContents;
  return host ? tabByWebContentsId.get(host.id) || null : null;
}

function findWindowByChromeWebContents(wc) {
  for (const w of windows.values()) if (w.chromeView.webContents === wc) return w;
  return null;
}

function allTabs() {
  return all().flatMap((w) => w.tabs);
}

module.exports = {
  createWindow,
  unregister,
  setLastFocused,
  getFocusedWindow,
  getWindowOfKind,
  all,
  get,
  registerTabWebContents,
  unregisterTabWebContents,
  findTabByWebContentsId,
  findTabByWebContents,
  findWindowByChromeWebContents,
  allTabs,
};
