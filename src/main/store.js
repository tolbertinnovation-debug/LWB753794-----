'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * A tiny persistent JSON store.
 *
 * - Reads synchronously on construction (fast startup, no async races).
 * - Writes are debounced and atomic (write to a temp file, then rename), so a
 *   crash mid-write can never corrupt the previous good copy.
 * - A corrupt file is moved aside (`*.corrupt-<time>`) and defaults are used.
 */
class JsonStore {
  /**
   * @param {string} filePath absolute path of the JSON file
   * @param {() => any} defaults factory returning the default data
   * @param {{ debounceMs?: number, migrate?: (data: any) => any }} [options]
   */
  constructor(filePath, defaults, options = {}) {
    this.filePath = filePath;
    this.debounceMs = options.debounceMs ?? 400;
    this._timer = null;
    this._dirty = false;
    this.data = this._load(defaults, options.migrate);
  }

  _load(defaults, migrate) {
    let data;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      data = JSON.parse(raw);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        try {
          fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
        } catch {
          /* ignore */
        }
      }
      data = defaults();
    }
    if (typeof migrate === 'function') data = migrate(data) ?? data;
    return data;
  }

  /** Schedule a debounced write. */
  save() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, this.debounceMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  /** Write immediately (synchronously) if there are pending changes. */
  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._dirty) return;
    this._dirty = false;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error(`[store] failed to write ${this.filePath}:`, err);
    }
  }
}

module.exports = { JsonStore };
