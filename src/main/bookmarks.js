'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { JsonStore } = require('./store');

const ROOTS = { bar: 'Bookmarks bar', other: 'Other bookmarks' };

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function makeRoot(id) {
  return { id, type: 'folder', title: ROOTS[id], children: [], dateAdded: Date.now() };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeHtml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/**
 * Bookmarks tree: two fixed roots ("bar" and "other") holding bookmarks and
 * nested folders.
 */
class Bookmarks extends EventEmitter {
  constructor(filePath) {
    super();
    this.store = new JsonStore(filePath, () => ({ bar: makeRoot('bar'), other: makeRoot('other') }), {
      migrate: (d) => ({
        bar: d?.bar?.children ? d.bar : makeRoot('bar'),
        other: d?.other?.children ? d.other : makeRoot('other'),
        readingListId: typeof d?.readingListId === 'string' ? d.readingListId : null,
      }),
    });
    this._index();
  }

  _index() {
    this._byId = new Map();
    this._parent = new Map();
    this._byUrl = new Map();
    const walk = (node, parent) => {
      this._byId.set(node.id, node);
      if (parent) this._parent.set(node.id, parent);
      if (node.type === 'bookmark') {
        const list = this._byUrl.get(node.url) || [];
        list.push(node);
        this._byUrl.set(node.url, list);
      } else {
        for (const child of node.children) walk(child, node);
      }
    };
    walk(this.store.data.bar, null);
    walk(this.store.data.other, null);
  }

  _changed() {
    this._index();
    this.store.save();
    this.emit('changed');
  }

  tree() {
    return { bar: this.store.data.bar, other: this.store.data.other };
  }

  readingListFolder() {
    let folder = this.get(this.store.data.readingListId);
    if (!folder || folder.type !== 'folder') {
      folder = this.add({ parentId: 'other', type: 'folder', title: 'Reading list' });
      this.store.data.readingListId = folder.id;
      this.store.save();
    }
    return folder;
  }

  saveForLater({ url, title }) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Only web pages can be saved');
    const folder = this.readingListFolder();
    const existing = folder.children.find((item) => item.type === 'bookmark' && item.url === url);
    return existing || this.add({ parentId: folder.id, url, title });
  }

  barItems() {
    return this.store.data.bar.children;
  }

  get(id) {
    return this._byId.get(id) || null;
  }

  isBookmarked(url) {
    return this._byUrl.has(url);
  }

  findByUrl(url) {
    return (this._byUrl.get(url) || [])[0] || null;
  }

  /**
   * Add a bookmark or folder.
   * @param {{ parentId?: string, title?: string, url?: string, type?: 'bookmark'|'folder', index?: number }} item
   */
  add({ parentId = 'bar', title = '', url = '', type = 'bookmark', index } = {}) {
    const parent = this.get(parentId);
    if (!parent || parent.type !== 'folder') throw new Error('Invalid parent folder');
    if (type === 'bookmark' && (typeof url !== 'string' || !url || url.length > 8192)) {
      throw new Error('Invalid URL');
    }
    const node =
      type === 'folder'
        ? { id: newId(), type: 'folder', title: String(title || 'New folder').slice(0, 512), children: [], dateAdded: Date.now() }
        : { id: newId(), type: 'bookmark', title: String(title || url).slice(0, 1024), url, dateAdded: Date.now() };
    const i = typeof index === 'number' ? Math.max(0, Math.min(index, parent.children.length)) : parent.children.length;
    parent.children.splice(i, 0, node);
    this._changed();
    return node;
  }

  update(id, { title, url } = {}) {
    const node = this.get(id);
    if (!node || ROOTS[id]) return null;
    if (typeof title === 'string') node.title = title.slice(0, 1024);
    if (typeof url === 'string' && node.type === 'bookmark' && url) node.url = url;
    this._changed();
    return node;
  }

  remove(id) {
    if (ROOTS[id]) return false;
    const parent = this._parent.get(id);
    if (!parent) return false;
    parent.children = parent.children.filter((c) => c.id !== id);
    this._changed();
    return true;
  }

  /** Remove every bookmark for a URL (used by the star toggle). */
  removeUrl(url) {
    const nodes = this._byUrl.get(url) || [];
    for (const n of nodes) {
      const parent = this._parent.get(n.id);
      if (parent) parent.children = parent.children.filter((c) => c.id !== n.id);
    }
    if (nodes.length) this._changed();
    return nodes.length > 0;
  }

  /** Move a node to `parentId` at `index`. */
  move(id, parentId, index) {
    const node = this.get(id);
    const newParent = this.get(parentId);
    if (!node || ROOTS[id] || !newParent || newParent.type !== 'folder') return false;
    // Can't move a folder into itself or its descendants.
    for (let p = newParent; p; p = this._parent.get(p.id)) if (p.id === id) return false;
    const oldParent = this._parent.get(id);
    const oldIndex = oldParent.children.indexOf(node);
    oldParent.children.splice(oldIndex, 1);
    let i = typeof index === 'number' ? index : newParent.children.length;
    if (oldParent === newParent && oldIndex < i) i -= 1;
    i = Math.max(0, Math.min(i, newParent.children.length));
    newParent.children.splice(i, 0, node);
    this._changed();
    return true;
  }

  search(query, limit = 50) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    for (const node of this._byId.values()) {
      if (node.type !== 'bookmark') continue;
      const hay = `${node.title} ${node.url}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) out.push(node);
      if (out.length >= limit) break;
    }
    return out;
  }

  folders() {
    const out = [];
    const walk = (node, depth) => {
      if (node.type !== 'folder') return;
      out.push({ id: node.id, title: node.title, depth });
      node.children.forEach((c) => walk(c, depth + 1));
    };
    walk(this.store.data.bar, 0);
    walk(this.store.data.other, 0);
    return out;
  }

  /** Export in the Netscape bookmark file format understood by every browser. */
  exportHtml() {
    const lines = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->',
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      '<TITLE>Bookmarks</TITLE>',
      '<H1>Bookmarks</H1>',
      '<DL><p>',
    ];
    const walk = (node, depth, extra = '') => {
      const pad = '    '.repeat(depth);
      const added = Math.floor((node.dateAdded || Date.now()) / 1000);
      if (node.type === 'folder') {
        lines.push(`${pad}<DT><H3 ADD_DATE="${added}"${extra}>${escapeHtml(node.title)}</H3>`);
        lines.push(`${pad}<DL><p>`);
        node.children.forEach((c) => walk(c, depth + 1));
        lines.push(`${pad}</DL><p>`);
      } else {
        lines.push(`${pad}<DT><A HREF="${escapeHtml(node.url)}" ADD_DATE="${added}">${escapeHtml(node.title)}</A>`);
      }
    };
    walk(this.store.data.bar, 1, ' PERSONAL_TOOLBAR_FOLDER="true"');
    this.store.data.other.children.forEach((c) => walk(c, 1));
    lines.push('</DL><p>');
    return lines.join('\n');
  }

  /**
   * Import a Netscape bookmark HTML file (Chrome/Firefox/Edge/Safari exports).
   * Toolbar items go to the bar; everything else to an "Imported" folder.
   * @returns {number} number of bookmarks imported
   */
  importHtml(html) {
    if (typeof html !== 'string' || html.length > 50 * 1024 * 1024) throw new Error('Invalid file');
    const tokenRe = /<DT>\s*<H3([^>]*)>([\s\S]*?)<\/H3>|<DT>\s*<A([^>]*)>([\s\S]*?)<\/A>|<\/DL>/gi;
    const imported = { id: newId(), type: 'folder', title: 'Imported', children: [], dateAdded: Date.now() };
    const stack = [imported];
    let count = 0;
    let pendingToolbar = false;
    let m;
    while ((m = tokenRe.exec(html))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) {
        const attrs = m[1];
        const isToolbar = /PERSONAL_TOOLBAR_FOLDER="true"/i.test(attrs);
        const folder = {
          id: newId(),
          type: 'folder',
          title: unescapeHtml(m[2].replace(/<[^>]+>/g, '').trim()) || 'Folder',
          children: [],
          dateAdded: Date.now(),
          _toolbar: isToolbar && !pendingToolbar,
        };
        if (folder._toolbar) pendingToolbar = true;
        top.children.push(folder);
        stack.push(folder);
      } else if (m[3] !== undefined) {
        const href = (m[3].match(/HREF="([^"]*)"/i) || [])[1];
        if (!href) continue;
        const url = unescapeHtml(href);
        if (/^(javascript|data):/i.test(url) || url.length > 8192) continue;
        const addDate = Number((m[3].match(/ADD_DATE="(\d+)"/i) || [])[1]) * 1000 || Date.now();
        top.children.push({
          id: newId(),
          type: 'bookmark',
          title: unescapeHtml(m[4].replace(/<[^>]+>/g, '').trim()) || url,
          url,
          dateAdded: addDate,
        });
        count++;
      } else if (stack.length > 1) {
        stack.pop();
      }
    }
    // Merge the toolbar folder into our bar; the rest into Other > Imported.
    const extractToolbar = (node) => {
      for (let i = 0; i < node.children.length; i++) {
        const c = node.children[i];
        if (c.type === 'folder' && c._toolbar) {
          node.children.splice(i, 1);
          return c;
        }
        if (c.type === 'folder') {
          const found = extractToolbar(c);
          if (found) return found;
        }
      }
      return null;
    };
    const toolbar = extractToolbar(imported);
    const clean = (node) => {
      delete node._toolbar;
      if (node.children) node.children.forEach(clean);
    };
    clean(imported);
    if (toolbar) {
      clean(toolbar);
      const existing = new Set(this.store.data.bar.children.filter((c) => c.type === 'bookmark').map((c) => c.url));
      for (const c of toolbar.children) {
        if (c.type === 'bookmark' && existing.has(c.url)) continue;
        this.store.data.bar.children.push(c);
      }
    }
    if (imported.children.length) this.store.data.other.children.push(imported);
    this._changed();
    return count;
  }

  flush() {
    this.store.flush();
  }
}

module.exports = { Bookmarks, escapeHtml };
