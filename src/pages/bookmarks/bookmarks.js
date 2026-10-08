import { h, $, faviconEl, debounce, hostOf } from '/_shared/dom.js';
import { icon } from '/_shared/icons.js';
import { call, lib, initPage, confirmDialog, formDialog, toast } from '/_shared/page.js';

let tree;
let current = new URLSearchParams(location.search).get('folder') || 'bar';
const byId = new Map();
const parentOf = new Map();

function index() {
  byId.clear();
  parentOf.clear();
  const walk = (n, parent) => {
    byId.set(n.id, n);
    if (parent) parentOf.set(n.id, parent.id);
    (n.children || []).forEach((c) => walk(c, n));
  };
  walk(tree.bar, null);
  walk(tree.other, null);
}

async function reload() {
  tree = await call('bookmarksTree');
  index();
  if (!byId.has(current)) current = 'bar';
  renderTree();
  renderList();
}

function renderTree() {
  const nav = $('#tree');
  nav.textContent = '';
  nav.append(h('div.brand', { html: `${icon('star', 22)}<span>Bookmarks</span>` }));
  const walk = (n, depth) => {
    if (n.type !== 'folder') return;
    const count = n.children.filter((c) => c.type === 'bookmark').length;
    const item = h(`button.nav-item.tree-item${n.id === current && !$('#q').value ? '.active' : ''}`, { style: { '--depth': depth }, html: icon(n.id === 'bar' ? 'bookmarks' : 'folder', 17) }, h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, n.title), count ? h('span.count', {}, String(count)) : null);
    item.addEventListener('click', () => {
      current = n.id;
      $('#q').value = '';
      renderTree();
      renderList();
    });
    // Drop bookmarks onto folders in the tree.
    item.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-lib-bookmark')) return;
      e.preventDefault();
      item.classList.add('drop');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop'));
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('drop');
      const id = e.dataTransfer.getData('application/x-lib-bookmark');
      if (id && id !== n.id) {
        const ok = await call('bookmarkMove', id, n.id);
        if (!ok) toast('A folder can’t be moved into itself');
      }
    });
    nav.append(item);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(tree.bar, 0);
  walk(tree.other, 0);
}

function crumbs(id) {
  const parts = [];
  for (let n = byId.get(id); n; n = byId.get(parentOf.get(n.id))) parts.unshift(n);
  return parts;
}

function renderList() {
  const list = $('#list');
  list.textContent = '';
  const q = $('#q').value.trim();
  let items;
  if (q) {
    list.append(h('div.crumbs', {}, `Search results for “${q}”`));
    items = null;
  } else {
    const c = h('div.crumbs');
    crumbs(current).forEach((n, i) => {
      if (i) c.append(h('span', { html: icon('chevronRight', 14) }));
      const b = h('a', { href: '#' }, n.title);
      b.addEventListener('click', (e) => {
        e.preventDefault();
        current = n.id;
        renderTree();
        renderList();
      });
      c.append(b);
    });
    list.append(c);
    items = byId.get(current)?.children || [];
  }
  const body = h('div.card-body');
  list.append(body);
  const fill = (arr) => {
    if (!arr.length) {
      body.append(h('div.empty', {}, h('div.empty-icon', { html: icon('star', 30) }), h('h2', {}, q ? 'No matching bookmarks' : 'This folder is empty'), h('p', {}, q ? 'Try a different search.' : 'Bookmark pages with the ★ in the address bar, or import them from another browser.')));
      return;
    }
    arr.forEach((n, i) => body.append(rowFor(n, i, !q)));
  };
  if (items) fill(items);
  else call('bookmarksSearch', q).then(fill);
}

function rowFor(n, i, draggable) {
  const isFolder = n.type === 'folder';
  const row = h(`div.list-row${isFolder ? '.folder' : ''}`, { draggable: draggable ? 'true' : 'false' });
  const ic = isFolder ? h('span.fav-tile', { html: icon('folder', 17) }) : h('span.fav-tile', {}, /^javascript:/i.test(n.url) ? h('span', { html: icon('zap', 16) }) : faviconEl('', n.url, 16));
  const title = h(isFolder ? 'span.title' : 'a.title', isFolder ? {} : { href: n.url, title: n.url }, n.title || n.url);
  const main = h('div.main-col', {}, title, !isFolder ? h('div.sub', {}, hostOf(n.url) || n.url) : h('div.sub', {}, `${n.children.length} item${n.children.length === 1 ? '' : 's'}`));
  const open = (e) => {
    if (isFolder) {
      current = n.id;
      $('#q').value = '';
      renderTree();
      renderList();
      return;
    }
    e.preventDefault();
    call('openUrl', n.url, e.ctrlKey || e.metaKey || e.button === 1 ? 'background' : e.shiftKey ? 'window' : 'current');
  };
  title.addEventListener('click', open);
  if (isFolder) row.addEventListener('dblclick', open);
  title.addEventListener('auxclick', (e) => e.button === 1 && open(e));
  const edit = h('button.icon-btn', { title: 'Edit', 'aria-label': 'Edit', html: icon('settings', 16) });
  edit.addEventListener('click', async () => {
    const res = await formDialog({
      title: isFolder ? 'Rename folder' : 'Edit bookmark',
      fields: isFolder ? [{ name: 'title', label: 'Name', value: n.title }] : [
        { name: 'title', label: 'Name', value: n.title },
        { name: 'url', label: 'URL', value: n.url },
      ],
    });
    if (res) await call('bookmarkUpdate', n.id, res);
  });
  const del = h('button.icon-btn', { title: 'Delete', 'aria-label': 'Delete', html: icon('trash', 16) });
  del.addEventListener('click', async () => {
    if (isFolder && n.children.length) {
      const ok = await confirmDialog({ title: `Delete “${n.title}”?`, message: `This folder contains ${n.children.length} item(s). They will be deleted too.`, confirm: 'Delete', danger: true });
      if (!ok) return;
    }
    await call('bookmarkRemove', n.id);
    toast(isFolder ? 'Folder deleted' : 'Bookmark deleted');
  });
  row.append(ic, main, h('div.actions', {}, edit, del));
  if (draggable) {
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-lib-bookmark', n.id);
      if (n.url) e.dataTransfer.setData('text/uri-list', n.url);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-lib-bookmark')) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const top = e.clientY < r.top + r.height / 2;
      row.classList.toggle('drag-over-top', top);
      row.classList.toggle('drag-over-bottom', !top);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over-top', 'drag-over-bottom'));
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      const top = row.classList.contains('drag-over-top');
      row.classList.remove('drag-over-top', 'drag-over-bottom');
      const id = e.dataTransfer.getData('application/x-lib-bookmark');
      if (!id || id === n.id) return;
      await call('bookmarkMove', id, current, top ? i : i + 1);
    });
  }
  return row;
}

async function main() {
  await initPage();
  $('#title').innerHTML = `${icon('star', 28)}Bookmarks`;
  $('#search-icon').innerHTML = icon('search', 17);
  $('#add-bm').innerHTML = `${icon('plus', 16)}Add bookmark`;
  $('#add-folder').innerHTML = `${icon('folder', 16)}New folder`;
  $('#import').innerHTML = `${icon('download', 16)}Import`;
  $('#export').innerHTML = `${icon('external', 16)}Export`;
  $('#add-bm').addEventListener('click', async () => {
    const res = await formDialog({ title: 'Add bookmark', fields: [{ name: 'title', label: 'Name' }, { name: 'url', label: 'URL', placeholder: 'https://' }], submit: 'Add' });
    if (!res || !res.url) return;
    let url = res.url;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    await call('bookmarkAdd', { parentId: current, title: res.title || url, url });
  });
  $('#add-folder').addEventListener('click', async () => {
    const res = await formDialog({ title: 'New folder', fields: [{ name: 'title', label: 'Name', value: 'New folder' }], submit: 'Create' });
    if (res) await call('bookmarkAdd', { parentId: current, type: 'folder', title: res.title || 'New folder' });
  });
  $('#import').addEventListener('click', async () => {
    const n = await call('bookmarksImport').catch(() => -2);
    if (n >= 0) toast(`Imported ${n} bookmark${n === 1 ? '' : 's'}`);
    else if (n === -2) toast('Couldn’t read that file');
  });
  $('#export').addEventListener('click', async () => {
    if (await call('bookmarksExport')) toast('Bookmarks exported');
  });
  $('#q').addEventListener('input', debounce(() => {
    renderTree();
    renderList();
  }, 120));
  lib.on('bookmarks', reload);
  await reload();
}

main();
