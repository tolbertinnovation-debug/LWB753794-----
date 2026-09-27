'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { shell, app, Notification } = require('electron');
const { JsonStore } = require('./store');
const ctx = require('./context');

const MAX_RECORDS = 500;

/** Find a free path: "file.zip" → "file (1).zip" → "file (2).zip" … */
function uniquePath(dir, filename) {
  const safe = (filename || 'download').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200) || 'download';
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let candidate = path.join(dir, safe);
  for (let i = 1; fs.existsSync(candidate) || fs.existsSync(`${candidate}.download`); i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
  }
  return candidate;
}

/**
 * Tracks downloads for every session. Completed/failed downloads are stored so
 * the Downloads page survives restarts (private downloads are memory-only).
 */
class DownloadManager extends EventEmitter {
  constructor(filePath) {
    super();
    this.store = new JsonStore(filePath, () => ({ items: [] }), {
      migrate: (d) => ({ items: Array.isArray(d?.items) ? d.items.slice(0, MAX_RECORDS) : [] }),
    });
    // Anything still "progressing" from a previous run was interrupted.
    for (const it of this.store.data.items) {
      if (it.state === 'progressing' || it.state === 'paused') it.state = 'interrupted';
    }
    /** @type {Map<string, Electron.DownloadItem>} */
    this.live = new Map();
    this.privateItems = [];
    this._saveAs = new Set();
    this._nextId = Date.now();
    this._emitTimer = null;
  }

  /** The next download of `url` should show a "Save as" dialog. */
  expectSaveAs(url) {
    this._saveAs.add(url);
    setTimeout(() => this._saveAs.delete(url), 30000).unref?.();
  }

  attach(ses, { isPrivate }) {
    ses.on('will-download', (_event, item, wc) => this._onDownload(item, wc, isPrivate));
  }

  _onDownload(item, wc, isPrivate) {
    const id = String(this._nextId++);
    const url = item.getURL();
    const askSaveAs = this._saveAs.delete(url) || ctx.settings.get('askWhereToSave');
    let dir = ctx.settings.get('downloadDir') || app.getPath('downloads');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      dir = app.getPath('downloads');
    }
    if (askSaveAs) {
      item.setSaveDialogOptions({ defaultPath: path.join(dir, item.getFilename()) });
    } else {
      item.setSavePath(uniquePath(dir, item.getFilename()));
    }

    const record = {
      id,
      url,
      filename: item.getFilename(),
      path: item.getSavePath() || '',
      mime: item.getMimeType(),
      state: 'progressing',
      received: 0,
      total: item.getTotalBytes(),
      speed: 0,
      startTime: Date.now(),
      endTime: 0,
      isPrivate,
      paused: false,
      canResume: false,
    };
    this.live.set(id, item);
    if (isPrivate) this.privateItems.unshift(record);
    else {
      this.store.data.items.unshift(record);
      if (this.store.data.items.length > MAX_RECORDS) this.store.data.items.length = MAX_RECORDS;
    }

    let lastBytes = 0;
    let lastTime = Date.now();
    item.on('updated', (_e, state) => {
      const now = Date.now();
      const received = item.getReceivedBytes();
      if (now - lastTime >= 500) {
        record.speed = Math.max(0, ((received - lastBytes) * 1000) / (now - lastTime));
        lastBytes = received;
        lastTime = now;
      }
      record.received = received;
      record.total = item.getTotalBytes();
      record.path = item.getSavePath() || record.path;
      record.filename = path.basename(record.path || record.filename);
      record.paused = item.isPaused();
      record.canResume = item.canResume();
      record.state = state === 'interrupted' ? 'interrupted' : record.paused ? 'paused' : 'progressing';
      this._changed();
    });
    item.once('done', (_e, state) => {
      this.live.delete(id);
      record.state = state; // 'completed' | 'cancelled' | 'interrupted'
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes() || record.received;
      record.path = item.getSavePath() || record.path;
      record.filename = path.basename(record.path || record.filename);
      record.endTime = Date.now();
      record.speed = 0;
      this._changed(true);
      if (!isPrivate) this.store.save();
      if (state === 'completed') {
        if (process.platform === 'darwin') app.dock?.downloadFinished(record.path);
        this._notify(record);
      }
      this.emit('done', record);
    });

    this.emit('started', record, wc);
    this._changed(true);
    if (!isPrivate) this.store.save();
  }

  _notify(record) {
    if (ctx.isTest || !Notification.isSupported()) return;
    // Only notify when no browser window is focused.
    const { BaseWindow } = require('electron');
    if (BaseWindow.getFocusedWindow()) return;
    const n = new Notification({ title: 'Download complete', body: record.filename, silent: true });
    n.on('click', () => shell.showItemInFolder(record.path));
    n.show();
  }

  _changed(immediate = false) {
    if (immediate) {
      clearTimeout(this._emitTimer);
      this._emitTimer = null;
      this.emit('changed');
      return;
    }
    if (this._emitTimer) return;
    this._emitTimer = setTimeout(() => {
      this._emitTimer = null;
      this.emit('changed');
    }, 250);
  }

  list(includePrivate = false) {
    const items = includePrivate ? [...this.privateItems, ...this.store.data.items] : this.store.data.items;
    return items.map((r) => ({ ...r, exists: r.state === 'completed' ? fs.existsSync(r.path) : undefined }));
  }

  /** Aggregate progress for the toolbar button / taskbar. */
  summary(includePrivate = false) {
    const all = includePrivate ? [...this.privateItems, ...this.store.data.items] : this.store.data.items;
    const active = all.filter((r) => r.state === 'progressing' || r.state === 'paused');
    let received = 0;
    let total = 0;
    for (const r of active) {
      received += r.received;
      total += r.total;
    }
    return {
      active: active.length,
      progress: total > 0 ? received / total : active.length ? -1 : 0,
      recent: all.slice(0, 6),
    };
  }

  _find(id) {
    return this.store.data.items.find((r) => r.id === id) || this.privateItems.find((r) => r.id === id);
  }

  pause(id) {
    this.live.get(id)?.pause();
  }

  resume(id) {
    const item = this.live.get(id);
    if (item && item.canResume()) item.resume();
  }

  cancel(id) {
    this.live.get(id)?.cancel();
  }

  open(id) {
    const r = this._find(id);
    if (r && r.state === 'completed') shell.openPath(r.path);
  }

  show(id) {
    const r = this._find(id);
    if (r && r.path) shell.showItemInFolder(r.path);
  }

  /** Retry a failed/cancelled download in the focused window. */
  retry(id) {
    const r = this._find(id);
    if (!r) return;
    const win = require('./windows').getFocusedWindow();
    win?.activeTab?.webContents?.downloadURL(r.url);
  }

  remove(id) {
    if (this.live.has(id)) this.live.get(id).cancel();
    this.store.data.items = this.store.data.items.filter((r) => r.id !== id);
    this.privateItems = this.privateItems.filter((r) => r.id !== id);
    this.store.save();
    this._changed(true);
  }

  /** Remove finished entries from the list (files stay on disk). */
  clear(since = 0) {
    const keep = (r) => this.live.has(r.id) || (since && r.startTime < since);
    this.store.data.items = this.store.data.items.filter(keep);
    this.privateItems = this.privateItems.filter(keep);
    this.store.save();
    this._changed(true);
  }

  clearPrivate() {
    this.privateItems = this.privateItems.filter((r) => this.live.has(r.id));
    this._changed(true);
  }

  flush() {
    this.store.flush();
  }
}

module.exports = { DownloadManager, uniquePath };
