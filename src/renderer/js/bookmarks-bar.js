import { h, $, faviconEl } from './util.js';
import { icon } from './icons.js';
import { state, bus, send } from './state.js';
import { openPopup, menuList } from './popups.js';

function openBookmark(item, e) {
  const where = e.button === 1 || e.ctrlKey || e.metaKey ? 'background' : e.shiftKey ? 'window' : 'current';
  send('openUrl', item.url, where);
}

function itemEl(item, index) {
  const el = h('button.bm-item', { title: item.type === 'folder' ? item.title : `${item.title}\n${item.url}`, draggable: 'true', 'data-index': index, 'data-id': item.id });
  if (item.type === 'folder') el.append(h('span', { html: icon('folder', 16) }));
  else if (/^javascript:/i.test(item.url)) el.append(h('span', { html: icon('zap', 15) }));
  else el.append(faviconEl(item.favicon, item.url, 16, icon('globe', 16)));
  if (item.title) el.append(h('span.bm-label', {}, item.title));
  el.addEventListener('click', (e) => {
    if (item.type === 'folder') {
      const r = el.getBoundingClientRect();
      send('showMenu', 'bookmarkFolder', { id: item.id, x: r.left, y: r.bottom + 2 });
    } else openBookmark(item, e);
  });
  el.addEventListener('auxclick', (e) => {
    if (e.button === 1 && item.type !== 'folder') openBookmark(item, e);
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    send('showMenu', 'bookmarkItem', { id: item.id, x: e.clientX, y: e.clientY });
  });
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-lib-bookmark', item.id);
    if (item.url) {
      e.dataTransfer.setData('text/uri-list', item.url);
      e.dataTransfer.setData('text/plain', item.url);
    }
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  return el;
}

function render() {
  const bar = $('#bookmarks-bar');
  bar.hidden = !state.settings.showBookmarksBar;
  if (bar.hidden) return;
  bar.textContent = '';
  const items = state.bookmarksBar || [];
  if (!items.length) {
    const link = h('button.link-btn', {}, 'Import bookmarks');
    link.addEventListener('click', () => send('openUrl', 'lib://bookmarks/', 'tab'));
    bar.append(h('span.bm-empty', {}, 'For quick access, bookmark pages with the ★ in the address bar. '), link);
    return;
  }
  const els = items.map((it, i) => itemEl(it, i));
  bar.append(...els);
  // Overflow: hide what doesn't fit and offer it in a » menu.
  requestAnimationFrame(() => {
    const barRect = bar.getBoundingClientRect();
    const limit = barRect.right - 44;
    const hidden = [];
    els.forEach((el, i) => {
      if (el.getBoundingClientRect().right > limit) {
        el.hidden = true;
        hidden.push(items[i]);
      }
    });
    if (hidden.length) {
      const more = h('button.icon-btn.small.bm-overflow', { title: 'More bookmarks', html: icon('chevronRight', 16) });
      more.addEventListener('click', () => {
        let popup;
        const list = menuList(
          hidden.map((it) => ({
            label: it.title || it.url,
            iconHtml: icon(it.type === 'folder' ? 'folder' : 'star', 16),
            onClick: (e) => {
              popup.close();
              if (it.type === 'folder') {
                const r = more.getBoundingClientRect();
                send('showMenu', 'bookmarkFolder', { id: it.id, x: r.left, y: r.bottom + 2 });
              } else openBookmark(it, e);
            },
          })),
        );
        popup = openPopup(list, { anchor: more, placement: 'bottom-end' });
      });
      bar.append(more);
    }
  });
}

function dropIndex(bar, x) {
  const els = [...bar.querySelectorAll('.bm-item:not([hidden])')];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (x < r.left + r.width / 2) return Number(el.dataset.index);
  }
  return els.length;
}

export function initBookmarksBar() {
  const bar = $('#bookmarks-bar');
  bar.addEventListener('dragover', (e) => {
    const types = e.dataTransfer.types;
    if (!types.includes('application/x-lib-bookmark') && !types.includes('text/uri-list') && !types.includes('text/plain')) return;
    e.preventDefault();
    const idx = dropIndex(bar, e.clientX);
    bar.querySelectorAll('.drop-before').forEach((el) => el.classList.remove('drop-before'));
    bar.querySelector(`.bm-item[data-index="${idx}"]`)?.classList.add('drop-before');
  });
  bar.addEventListener('dragleave', () => bar.querySelectorAll('.drop-before').forEach((el) => el.classList.remove('drop-before')));
  bar.addEventListener('drop', (e) => {
    e.preventDefault();
    bar.querySelectorAll('.drop-before').forEach((el) => el.classList.remove('drop-before'));
    const idx = dropIndex(bar, e.clientX);
    const id = e.dataTransfer.getData('application/x-lib-bookmark');
    if (id) {
      send('bookmarkMove', id, 'bar', idx);
      return;
    }
    const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
    if (url) send('addBookmarkFromDrop', url, url, idx);
  });
  bar.addEventListener('contextmenu', (e) => {
    if (e.target !== bar && !e.target.classList.contains('bm-empty')) return;
    e.preventDefault();
    send('showMenu', 'bookmarkBar', { x: e.clientX, y: e.clientY });
  });
  bus.on('bookmarks-bar', render);
  bus.on('settings', render);
  window.addEventListener('resize', () => {
    clearTimeout(initBookmarksBar.t);
    initBookmarksBar.t = setTimeout(render, 100);
  });
  render();
}
