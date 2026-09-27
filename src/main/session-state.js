'use strict';

const { JsonStore } = require('./store');

const MAX_CLOSED = 25;

/**
 * Persists open windows/tabs (for "continue where you left off" and crash
 * recovery) and keeps a stack of recently closed tabs/windows.
 */
class SessionState {
  constructor(filePath) {
    this.store = new JsonStore(filePath, () => ({ windows: [], closed: [] }), {
      debounceMs: 1000,
      migrate: (d) => ({
        windows: Array.isArray(d?.windows) ? d.windows : [],
        closed: Array.isArray(d?.closed) ? d.closed.slice(0, MAX_CLOSED) : [],
      }),
    });
    this.frozen = false;
  }

  /** Windows saved by the previous run. */
  savedWindows() {
    return this.store.data.windows.filter((w) => Array.isArray(w.tabs) && w.tabs.length);
  }

  /** Debounced capture + write of the live session. */
  scheduleSave() {
    if (this.frozen || this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, 1000);
    this._timer.unref?.();
  }

  /** Snapshot live windows into the store. */
  capture() {
    const windows = require('./windows').all().filter((w) => !w.isPrivate && !w.closed);
    this.store.data.windows = windows.map((w) => w.serialize());
  }

  /** Called right before writes (store.flush) and on quit. */
  flush() {
    if (!this.frozen) this.capture();
    this.store.save();
    this.store.flush();
  }

  /** Stop recording changes (during quit, windows close one by one). */
  freeze() {
    clearTimeout(this._timer);
    this._timer = null;
    this.capture();
    this.frozen = true;
    this.store.save();
    this.store.flush();
  }

  unfreeze() {
    this.frozen = false;
  }

  pushClosedTab(data, index, windowId) {
    if (!data || !data.url) return;
    if (data.url.startsWith('lib://newtab') && !(data.history && data.history.entries && data.history.entries.length > 1)) return;
    this.store.data.closed.unshift({ type: 'tab', data, index, windowId, time: Date.now() });
    this.store.data.closed.length = Math.min(this.store.data.closed.length, MAX_CLOSED);
    this.scheduleSave();
  }

  pushClosedWindow(data) {
    if (!data || !data.tabs || !data.tabs.length) return;
    this.store.data.closed.unshift({ type: 'window', data, time: Date.now() });
    this.store.data.closed.length = Math.min(this.store.data.closed.length, MAX_CLOSED);
    this.scheduleSave();
  }

  popClosed() {
    const item = this.store.data.closed.shift() || null;
    if (item) this.scheduleSave();
    return item;
  }

  recentlyClosed(limit = 10) {
    return this.store.data.closed.slice(0, limit).map((c, i) => ({
      index: i,
      type: c.type,
      title: c.type === 'tab' ? c.data.title || c.data.url : `${c.data.tabs.length} tabs`,
      url: c.type === 'tab' ? c.data.url : '',
      favicon: c.type === 'tab' ? c.data.favicon : '',
    }));
  }

  takeClosed(index) {
    const [item] = this.store.data.closed.splice(index, 1);
    if (item) this.scheduleSave();
    return item || null;
  }

  clearClosed() {
    this.store.data.closed = [];
    this.scheduleSave();
  }
}

module.exports = { SessionState };
