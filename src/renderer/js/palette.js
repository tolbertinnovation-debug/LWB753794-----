import { h, faviconEl, debounce } from './util.js';
import { icon } from './icons.js';
import { state, bus, invoke, send } from './state.js';
import { openPopup } from './popups.js';

const COMMAND_ICONS = {
  newTab: 'plus',
  newWindow: 'newWindow',
  newPrivateWindow: 'incognito',
  closeTab: 'x',
  closeWindow: 'x',
  reopenClosed: 'restore',
  duplicateTab: 'copy',
  pinTab: 'pin',
  muteTab: 'volumeX',
  closeOtherTabs: 'x',
  moveToNewWindow: 'newWindow',
  splitView: 'split',
  closeSplit: 'split',
  back: 'arrowLeft',
  forward: 'arrowRight',
  reload: 'reload',
  hardReload: 'reload',
  home: 'home',
  find: 'search',
  zoomIn: 'zoomIn',
  zoomOut: 'zoomOut',
  zoomReset: 'search',
  reader: 'reader',
  print: 'printer',
  savePage: 'save',
  screenshot: 'camera',
  fullScreenshot: 'camera',
  pip: 'pip',
  translate: 'translate',
  copyUrl: 'link',
  viewSource: 'code',
  devtools: 'code',
  taskManager: 'activity',
  bookmarkPage: 'star',
  bookmarkAllTabs: 'star',
  toggleBookmarksBar: 'bookmarks',
  bookmarksManager: 'star',
  history: 'history',
  downloads: 'download',
  settings: 'settings',
  clearData: 'broom',
  toggleAdblockSite: 'shield',
  fullscreen: 'fullscreen',
  toggleTheme: 'moon',
  toggleVerticalTabs: 'sidebar',
  toggleCompact: 'compact',
  about: 'info',
  shortcuts: 'keyboard',
  quit: 'exit',
};

/** Fuzzy score: subsequence match with bonuses for word starts and contiguity. */
export function fuzzy(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx !== -1) return 1000 - idx + (idx === 0 || /\W/.test(t[idx - 1]) ? 200 : 0);
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found === -1) return 0;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 5 + (found === 0 || /\W/.test(t[found - 1]) ? 15 : 0);
    ti = found + 1;
  }
  return score;
}

let open = null;

export function openPalette(initial = '') {
  if (open && !open.closed) {
    open.el.querySelector('input')?.focus();
    return open;
  }
  const inputEl = h('input', { type: 'text', placeholder: 'Search tabs, bookmarks, history and commands…', spellcheck: 'false', 'aria-label': 'Search' });
  inputEl.value = initial;
  const list = h('div.palette-list', { role: 'listbox' });
  const root = h(
    'div.palette',
    {},
    h('div.palette-input', {}, h('span', { html: icon('search', 20) }), inputEl, h('kbd', {}, 'Esc')),
    list,
    h('div.palette-foot', {}, h('span', {}, '↑↓ to navigate'), h('span', {}, '↵ to open'), h('span', {}, 'Alt+↵ in new tab')),
  );
  let rows = [];
  let selected = 0;
  let data = { tabs: [], bookmarks: [], history: [], recentlyClosed: [] };
  let seq = 0;

  const pick = (row, e) => {
    popup.close();
    row.run(e || {});
  };

  const render = () => {
    const q = inputEl.value.trim();
    list.textContent = '';
    rows = [];
    const groups = [];
    const tabs = data.tabs
      .map((t) => ({ t, s: Math.max(fuzzy(q, t.title), fuzzy(q, t.url) * 0.8) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => (q ? b.s - a.s : 0))
      .slice(0, q ? 6 : 8)
      .map(({ t }) => ({
        title: t.title,
        sub: t.url.startsWith('lib://newtab') ? '' : t.url,
        iconEl: faviconEl(t.favicon, t.url, 16, icon('globe', 16)),
        badge: t.active ? 'Current' : 'Switch',
        run: () => send('switchToTab', t.windowId, t.tabId),
      }));
    if (tabs.length) groups.push(['Open tabs', tabs]);
    const cmds = state.commands
      .map((c) => ({ c, s: Math.max(fuzzy(q, c.label), fuzzy(q, `${c.section} ${c.label}`) * 0.7) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, q ? 8 : 6)
      .map(({ c }) => ({
        title: c.label,
        sub: c.section,
        iconHtml: icon(COMMAND_ICONS[c.id] || 'zap', 16),
        shortcut: c.shortcut,
        run: () => send('command', c.id),
      }));
    if (cmds.length) groups.push(['Commands', cmds]);
    if (q) {
      const bm = data.bookmarks.map((b) => ({ title: b.title || b.url, sub: b.url, iconHtml: icon('star', 16), run: (e) => send('openUrl', b.url, e.altKey ? 'tab' : 'current') }));
      if (bm.length) groups.push(['Bookmarks', bm]);
      const hist = data.history.map((x) => ({ title: x.title || x.url, sub: x.url, iconEl: faviconEl(x.favicon, x.url, 16, icon('history', 16)), run: (e) => send('openUrl', x.url, e.altKey ? 'tab' : 'current') }));
      if (hist.length) groups.push(['History', hist]);
      groups.push([
        'Search',
        [{ title: q, sub: `Search ${state.settings.searchEngineName || 'the web'}`, iconHtml: icon('search', 16), run: (e) => send('navigate', `?${q}`, e.altKey ? 'tab' : 'current') }],
      ]);
    } else if (data.recentlyClosed.length) {
      groups.push([
        'Recently closed',
        data.recentlyClosed.map((c) => ({
          title: c.title,
          sub: c.type === 'window' ? 'Window' : c.url,
          iconEl: c.type === 'tab' ? faviconEl(c.favicon, c.url, 16, icon('restore', 16)) : null,
          iconHtml: c.type === 'window' ? icon('newWindow', 16) : null,
          run: () => send('reopenClosedAt', c.index),
        })),
      ]);
    }
    for (const [name, items] of groups) {
      list.append(h('div.palette-group', {}, name));
      for (const item of items) {
        const i = rows.length;
        const iconWrap = h('span.sugg-icon');
        if (item.iconEl) iconWrap.append(item.iconEl);
        else iconWrap.innerHTML = item.iconHtml || '';
        const row = h(
          'div.sugg',
          { role: 'option' },
          iconWrap,
          h('span.sugg-text', {}, h('span.sugg-title', {}, item.title), item.sub ? h('span.sugg-sub', {}, item.sub) : null),
          item.badge ? h('span.sugg-badge', {}, item.badge) : null,
          item.shortcut ? h('span.kbd', {}, item.shortcut) : null,
        );
        row.addEventListener('mousemove', () => select(i));
        row.addEventListener('click', (e) => pick(item, e));
        list.append(row);
        rows.push({ ...item, el: row });
      }
    }
    if (!rows.length) list.append(h('div.empty-note', {}, 'No matches'));
    select(Math.min(selected, rows.length - 1));
  };

  const select = (i) => {
    if (i < 0) i = 0;
    selected = i;
    rows.forEach((r, j) => r.el.classList.toggle('selected', j === i));
    rows[i]?.el.scrollIntoView({ block: 'nearest' });
  };

  const load = debounce(async () => {
    const my = ++seq;
    const res = await invoke('paletteSearch', inputEl.value.trim()).catch(() => null);
    if (my !== seq || !res) return;
    data = res;
    render();
  }, 60);

  inputEl.addEventListener('input', () => {
    selected = 0;
    render();
    load();
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      select((selected + 1) % Math.max(1, rows.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      select((selected - 1 + rows.length) % Math.max(1, rows.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[selected]) pick(rows[selected], e);
    }
  });

  const popup = openPopup(root, {
    modal: true,
    placement: 'top-center',
    focus: inputEl,
    onClose: () => {
      open = null;
    },
  });
  open = popup;
  render();
  load();
  return popup;
}

export function initPalette() {
  bus.on('palette-open', () => openPalette());
}
