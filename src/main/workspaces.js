'use strict';
const crypto = require('node:crypto');
const { JsonStore } = require('./store');
function safeTabs(tabs) {
  if (!Array.isArray(tabs)) return [];
  return tabs.slice(0, 100).flatMap(t => {
    try {
      const u = new URL(t.url);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.href.length > 8192) return [];
      return [{ url: u.href, title: String(t.title || u.hostname).slice(0, 512), pinned: Boolean(t.pinned) }];
    } catch { return []; }
  });
}
class Workspaces {
  constructor(file) {
    this.store = new JsonStore(file, () => ({ items: [] }), {
      migrate: d => ({ items: (Array.isArray(d?.items) ? d.items : []).slice(0, 100).filter(x => x && typeof x.id === 'string').map(x => ({ id: x.id, name: String(x.name || 'Workspace').slice(0, 80), tabs: safeTabs(x.tabs), dateAdded: Number(x.dateAdded) || 0 })) }),
    });
  }
  list() { return this.store.data.items; }
  get(id) { return this.list().find(x => x.id === id); }
  save(name, tabs) {
    const clean = safeTabs(tabs);
    if (!clean.length) throw Error('Open a web page before saving a workspace');
    if (this.list().length >= 100) throw Error('Remove a workspace before saving another (limit: 100)');
    const item = { id: crypto.randomBytes(12).toString('hex'), name: String(name || 'Workspace').trim().slice(0, 80) || 'Workspace', tabs: clean, dateAdded: Date.now() };
    this.list().unshift(item); this.store.save(); return item;
  }
  rename(id, name) { const item = this.get(id); const value = String(name || '').trim().slice(0, 80); if (!item || !value) return false; item.name = value; this.store.save(); return true; }
  remove(id) { const before = this.list().length; this.store.data.items = this.list().filter(x => x.id !== id); this.store.save(); return before !== this.list().length; }
  flush() { this.store.flush(); }
}
module.exports = { Workspaces, safeTabs };
