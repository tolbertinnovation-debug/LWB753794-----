'use strict';

const { EventEmitter } = require('node:events');
const { JsonStore } = require('./store');

const MAX_VISITS = 30000;
const MAX_URLS = 15000;
const DAY = 24 * 60 * 60 * 1000;

/** URLs we never record. */
function isRecordable(url) {
  if (typeof url !== 'string') return false;
  return /^(https?|file):/i.test(url);
}

/**
 * Browsing history.
 *
 * Two structures are persisted:
 *  - `visits`: an append-only visit log (for the History page, grouped by day)
 *  - `urls`:   one aggregate record per URL (for address-bar ranking / top sites)
 */
class History extends EventEmitter {
  constructor(filePath) {
    super();
    this.store = new JsonStore(filePath, () => ({ visits: [], urls: {}, nextId: 1 }), {
      debounceMs: 1500,
      migrate: (d) => ({
        visits: Array.isArray(d?.visits) ? d.visits : [],
        urls: d?.urls && typeof d.urls === 'object' ? d.urls : {},
        nextId: typeof d?.nextId === 'number' ? d.nextId : 1,
      }),
    });
  }

  get data() {
    return this.store.data;
  }

  /**
   * Record a visit.
   * @param {{ url: string, title?: string, favicon?: string, typed?: boolean }} v
   */
  addVisit({ url, title = '', favicon = '', typed = false }) {
    if (!isRecordable(url)) return null;
    const now = Date.now();
    const d = this.data;
    // Collapse rapid duplicate visits (redirect chains, reloads) into one.
    const last = d.visits[d.visits.length - 1];
    const known = d.urls[url]?.title || '';
    if (last && last.url === url && now - last.time < 30 * 1000) {
      if (title) last.title = title;
      last.time = now;
    } else {
      // The page's <title> usually arrives after the visit; reuse the known one meanwhile.
      d.visits.push({ id: d.nextId++, url, title: title || known, time: now });
      if (d.visits.length > MAX_VISITS) d.visits.splice(0, d.visits.length - MAX_VISITS);
    }
    const rec = d.urls[url] || { title: '', visits: 0, typed: 0, last: 0, first: now, favicon: '' };
    rec.visits += 1;
    if (typed) rec.typed += 1;
    rec.last = now;
    if (title) rec.title = title;
    if (favicon) rec.favicon = favicon;
    d.urls[url] = rec;
    this._trimUrls();
    this.store.save();
    this.emit('changed');
    return rec;
  }

  /** Update the title/favicon of the most recent visit to `url`. */
  updatePage(url, { title, favicon } = {}) {
    const rec = this.data.urls[url];
    if (!rec) return;
    let changed = false;
    if (title) {
      if (rec.title !== title) {
        rec.title = title;
        changed = true;
      }
      // Also fix up the most recent visit of this URL.
      for (let i = this.data.visits.length - 1, n = 0; i >= 0 && n < 50; i--, n++) {
        const v = this.data.visits[i];
        if (v.url !== url) continue;
        if (v.title !== title) {
          v.title = title;
          changed = true;
        }
        break;
      }
    }
    if (favicon && rec.favicon !== favicon) {
      rec.favicon = favicon;
      changed = true;
    }
    if (changed) this.store.save();
  }

  _trimUrls() {
    const keys = Object.keys(this.data.urls);
    if (keys.length <= MAX_URLS) return;
    keys
      .sort((a, b) => this.data.urls[a].last - this.data.urls[b].last)
      .slice(0, keys.length - MAX_URLS)
      .forEach((k) => delete this.data.urls[k]);
  }

  /** Frecency: frequency weighted by recency, with typed URLs boosted. */
  static score(rec, now = Date.now()) {
    const age = (now - rec.last) / DAY;
    let recency;
    if (age < 1) recency = 100;
    else if (age < 4) recency = 70;
    else if (age < 14) recency = 50;
    else if (age < 31) recency = 30;
    else if (age < 90) recency = 10;
    else recency = 3;
    return (rec.visits + rec.typed * 2) * recency;
  }

  /**
   * Search history for the address bar.
   * @returns {Array<{url,title,favicon,score}>}
   */
  searchUrls(query, limit = 8) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/).filter(Boolean);
    const now = Date.now();
    const results = [];
    for (const [url, rec] of Object.entries(this.data.urls)) {
      const lowerUrl = url.toLowerCase();
      const lowerTitle = (rec.title || '').toLowerCase();
      if (!words.every((w) => lowerUrl.includes(w) || lowerTitle.includes(w))) continue;
      let score = History.score(rec, now);
      const bare = lowerUrl.replace(/^[a-z]+:\/\/(www\.)?/, '');
      if (bare.startsWith(q)) score *= 4; // host prefix match
      else if (lowerTitle.startsWith(q)) score *= 2;
      // Prefer root pages when the query matches the host.
      if (bare.startsWith(q) && /^[^/]+\/?$/.test(bare)) score *= 1.5;
      results.push({ url, title: rec.title, favicon: rec.favicon, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Inline-autocomplete candidate: the best host (+ path) that starts with
   * the typed text, e.g. "git" → "github.com".
   */
  inlineCompletion(text) {
    return this.inlineMatch(text)?.completion || null;
  }

  /**
   * Like inlineCompletion, plus the real URL to open (keeps the scheme and
   * "www." the site was actually visited with).
   * @returns {{ completion: string, url: string } | null}
   */
  inlineMatch(text) {
    const q = text.trim().toLowerCase();
    if (!q || /\s/.test(q)) return null;
    const now = Date.now();
    let best = null;
    let bestScore = 0;
    for (const [url, rec] of Object.entries(this.data.urls)) {
      let u;
      let rest;
      try {
        u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) continue;
        rest = (u.host + u.pathname).replace(/^www\./, '').replace(/\/$/, '');
      } catch {
        continue;
      }
      if (!rest.startsWith(q)) continue;
      // Complete only up to the host unless the user is typing a path.
      const slash = rest.indexOf('/', q.length);
      const completion = q.includes('/') ? rest : rest.slice(0, slash === -1 ? rest.length : slash);
      const score = History.score(rec, now) + (rec.typed > 0 ? 1000 : 0);
      if (score > bestScore) {
        bestScore = score;
        const target = q.includes('/') ? url : `${u.protocol}//${u.host}/`;
        best = { completion, url: target };
      }
    }
    if (!best || best.completion === q) return null;
    return best;
  }

  /** Most visited sites for the new tab page (one per host). */
  topSites(limit = 8, hidden = []) {
    const hiddenSet = new Set(hidden);
    const byHost = new Map();
    const now = Date.now();
    for (const [url, rec] of Object.entries(this.data.urls)) {
      let host;
      try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) continue;
        host = u.hostname.replace(/^www\./, '');
      } catch {
        continue;
      }
      if (hiddenSet.has(host)) continue;
      const score = History.score(rec, now);
      const cur = byHost.get(host);
      const isRoot = /^https?:\/\/[^/]+\/?$/.test(url);
      if (!cur) {
        byHost.set(host, { host, url, title: rec.title, favicon: rec.favicon, score, root: isRoot });
      } else {
        cur.score += score;
        if (isRoot && !cur.root) {
          cur.url = url;
          cur.title = rec.title || cur.title;
          cur.root = true;
        }
        if (!cur.favicon && rec.favicon) cur.favicon = rec.favicon;
      }
    }
    return [...byHost.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ host, url, title, favicon }) => ({ host, url, title: title || host, favicon }));
  }

  /**
   * Query the visit log for the History page.
   * @param {{ text?: string, before?: number, limit?: number }} q
   */
  query({ text = '', before = Infinity, limit = 200 } = {}) {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    const visits = this.data.visits;
    for (let i = visits.length - 1; i >= 0 && out.length < limit; i--) {
      const v = visits[i];
      if (v.time >= before) continue;
      if (words.length) {
        const hay = `${v.url} ${v.title}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
      }
      const rec = this.data.urls[v.url];
      out.push({ ...v, favicon: rec?.favicon || '' });
    }
    return out;
  }

  /** Delete visits by id; URLs with no remaining visits are forgotten. */
  deleteVisits(ids) {
    const set = new Set(ids);
    const removedUrls = new Set();
    this.data.visits = this.data.visits.filter((v) => {
      if (set.has(v.id)) {
        removedUrls.add(v.url);
        return false;
      }
      return true;
    });
    const stillVisited = new Set(this.data.visits.map((v) => v.url));
    for (const url of removedUrls) if (!stillVisited.has(url)) delete this.data.urls[url];
    this.store.save();
    this.emit('changed');
  }

  /** Remove every trace of a URL (Shift+Delete in the address bar). */
  deleteUrl(url) {
    delete this.data.urls[url];
    this.data.visits = this.data.visits.filter((v) => v.url !== url);
    this.store.save();
    this.emit('changed');
  }

  /** Remove all visits in [since, now]. `since = 0` clears everything. */
  clear(since = 0) {
    if (!since) {
      this.data.visits = [];
      this.data.urls = {};
    } else {
      this.data.visits = this.data.visits.filter((v) => v.time < since);
      const remaining = new Map(); // url -> { count, last }
      for (const v of this.data.visits) {
        const r = remaining.get(v.url) || { count: 0, last: 0 };
        r.count += 1;
        r.last = Math.max(r.last, v.time);
        remaining.set(v.url, r);
      }
      for (const [url, rec] of Object.entries(this.data.urls)) {
        if (rec.last < since) continue;
        const r = remaining.get(url);
        if (!r) delete this.data.urls[url];
        else {
          rec.last = r.last;
          rec.visits = r.count;
        }
      }
    }
    this.store.save();
    this.emit('changed');
  }

  flush() {
    this.store.flush();
  }
}

module.exports = { History, isRecordable };
