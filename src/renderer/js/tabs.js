import { h, $, faviconEl } from './util.js';
import { icon, logo } from './icons.js';
import { state, bus, invoke, send } from './state.js';

const INTERNAL_ICONS = {
  settings: 'settings',
  history: 'history',
  bookmarks: 'star',
  downloads: 'download',
  reader: 'reader',
  tasks: 'activity',
  shortcuts: 'keyboard',
};

export function tabTitle(t) {
  if (t.title) return t.title;
  if (!t.url || t.url.startsWith('lib://newtab')) return 'New Tab';
  return t.url;
}

function iconKey(t) {
  if (t.crashed) return 'crashed';
  if (t.loading && !t.discarded) return 'loading';
  if (t.url.startsWith('lib://')) return `lib:${t.url.slice(6).split(/[/?#]/)[0]}`;
  return `fav:${t.favicon || ''}`;
}

function renderIcon(el, t) {
  const key = iconKey(t);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.textContent = '';
  if (key === 'crashed') el.innerHTML = icon('sad', 16);
  else if (key === 'loading') el.append(h('span.spinner'));
  else if (key.startsWith('lib:')) {
    const page = key.slice(4);
    el.innerHTML = INTERNAL_ICONS[page] ? icon(INTERNAL_ICONS[page], 16) : logo(16);
  } else el.append(faviconEl(t.favicon, t.url, 16, icon('globe', 16)));
}

function audioButton(t) {
  if (!t.audible && !t.muted) return null;
  const b = h('button.tab-audio', {
    title: t.muted ? 'Unmute tab' : 'Mute tab',
    'aria-label': t.muted ? 'Unmute tab' : 'Mute tab',
    html: icon(t.muted ? 'volumeX' : 'volume', 14),
  });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    send('tabAction', t.id, 'mute');
  });
  return b;
}

/**
 * Keyed renderer shared by the horizontal strip and the vertical sidebar.
 */
class TabList {
  constructor(container, { vertical }) {
    this.container = container;
    this.vertical = vertical;
    this.els = new Map();
    this.frozen = false;
  }

  render(tabs, activeId, split) {
    const seen = new Set();
    const splitIds = split ? split.tabIds : [];
    tabs.forEach((t) => {
      seen.add(t.id);
      let el = this.els.get(t.id);
      if (!el) {
        el = this.create(t);
        this.els.set(t.id, el);
        if (!this.vertical && this.initialized) el.classList.add('entering');
        setTimeout(() => el.classList.remove('entering'), 250);
      }
      this.update(el, t, activeId, splitIds);
    });
    for (const [id, el] of this.els) {
      if (!seen.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
    // Order DOM like the model (pinned first in vertical mode handled by parent).
    const parentFor = (t) => (this.vertical && t.pinned ? this.pinnedContainer : this.container);
    let prev = { pinned: null, normal: null };
    for (const t of tabs) {
      const el = this.els.get(t.id);
      const parent = parentFor(t);
      const key = this.vertical && t.pinned ? 'pinned' : 'normal';
      const expectedNext = prev[key] ? prev[key].nextSibling : parent.firstChild;
      if (el.parentNode !== parent || expectedNext !== el) {
        if (prev[key]) prev[key].after(el);
        else parent.prepend(el);
      }
      prev[key] = el;
    }
    this.initialized = true;
  }

  create(t) {
    const el = h(this.vertical ? 'div.vtab' : 'div.tab', { role: 'tab', 'data-id': t.id, tabindex: '-1' });
    if (!this.vertical) el.append(h('span.tab-bg'), h('span.tab-foot'));
    el.append(h('span.tab-icon'), h('span.tab-title'), h('span.tab-audio-slot'));
    const close = h('button.tab-close', { title: 'Close tab', 'aria-label': 'Close tab', html: icon('x', 14) });
    close.addEventListener('pointerdown', (e) => e.stopPropagation());
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.freezeWidths();
      send('closeTab', Number(el.dataset.id));
    });
    el.append(close);
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e, el));
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.freezeWidths();
        send('closeTab', Number(el.dataset.id));
      }
    });
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault(); // no autoscroll
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      send('showMenu', 'tab', { tabId: Number(el.dataset.id), x: e.clientX, y: e.clientY });
    });
    return el;
  }

  update(el, t, activeId, splitIds) {
    el.classList.toggle('active', t.id === activeId);
    el.classList.toggle('pinned', Boolean(t.pinned));
    el.classList.toggle('discarded', Boolean(t.discarded));
    el.classList.toggle('crashed', Boolean(t.crashed));
    el.classList.toggle('split-member', splitIds.includes(t.id));
    el.setAttribute('aria-selected', String(t.id === activeId));
    const title = tabTitle(t);
    const titleEl = el.querySelector('.tab-title');
    if (titleEl.textContent !== title) titleEl.textContent = title;
    const tip = t.discarded ? `${title}\n(sleeping to save memory)` : title;
    if (el.title !== tip) el.title = tip;
    renderIcon(el.querySelector('.tab-icon'), t);
    const audioKey = `${t.audible}|${t.muted}`;
    const slot = el.querySelector('.tab-audio-slot');
    if (slot.dataset.key !== audioKey) {
      slot.dataset.key = audioKey;
      slot.textContent = '';
      const b = audioButton(t);
      if (b) slot.append(b);
    }
  }

  /** Keep tab widths stable while closing tabs with the mouse (like Chrome). */
  freezeWidths() {
    if (this.vertical || this.frozen) return;
    this.frozen = true;
    for (const el of this.els.values()) {
      if (el.classList.contains('pinned')) continue;
      el.style.setProperty('--w', `${el.getBoundingClientRect().width}px`);
      el.style.flexShrink = '0';
    }
    const unfreeze = () => {
      this.frozen = false;
      for (const el of this.els.values()) {
        el.style.removeProperty('--w');
        el.style.flexShrink = '';
      }
    };
    $('#tabbar').addEventListener('pointerleave', unfreeze, { once: true });
  }

  onPointerDown(e, el) {
    if (e.button !== 0) return;
    const id = Number(el.dataset.id);
    if (id !== state.activeId) send('activateTab', id);
    const axis = this.vertical ? 'clientY' : 'clientX';
    const start = e[axis];
    const startCross = this.vertical ? e.clientX : e.clientY;
    let dragging = false;
    const siblings = () => [...el.parentNode.children].filter((c) => c.dataset.id);
    const size = () => (this.vertical ? el.offsetHeight : el.offsetWidth);
    let targetIndex = -1;
    let detach = false;

    const move = (ev) => {
      const delta = ev[axis] - start;
      if (!dragging && Math.abs(delta) < 6) return;
      if (!dragging) {
        dragging = true;
        el.classList.add('dragging');
        el.setPointerCapture(ev.pointerId);
        for (const s of siblings()) if (s !== el) s.classList.add('shifting');
      }
      const list = siblings();
      const myIndex = list.indexOf(el);
      const rect0 = el.getBoundingClientRect();
      const offset = delta;
      el.style.transform = this.vertical ? `translateY(${offset}px)` : `translateX(${offset}px)`;
      // Tear-off: dragging far away from the strip moves the tab to a new window.
      const cross = (this.vertical ? ev.clientX : ev.clientY) - startCross;
      detach = !this.vertical && Math.abs(cross) > 70;
      el.style.opacity = detach ? '0.6' : '';
      const center = (this.vertical ? rect0.top + rect0.height / 2 : rect0.left + rect0.width / 2);
      targetIndex = myIndex;
      list.forEach((s, i) => {
        if (s === el) return;
        const r = s.getBoundingClientRect();
        const sCenter = this.vertical ? r.top + r.height / 2 - (parseFloat(s.dataset.shift) || 0) : r.left + r.width / 2 - (parseFloat(s.dataset.shift) || 0);
        let shift = 0;
        if (i > myIndex && center > sCenter) {
          shift = -size();
          targetIndex = Math.max(targetIndex, i);
        } else if (i < myIndex && center < sCenter) {
          shift = size();
          targetIndex = Math.min(targetIndex, i);
        }
        s.dataset.shift = String(shift);
        s.style.transform = shift ? (this.vertical ? `translateY(${shift}px)` : `translateX(${shift}px)`) : '';
      });
    };

    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!dragging) return;
      const list = siblings();
      for (const s of list) {
        s.classList.remove('shifting');
        s.style.transform = '';
        delete s.dataset.shift;
      }
      el.classList.remove('dragging');
      el.style.transform = '';
      el.style.opacity = '';
      if (detach && state.tabs.length > 1) {
        send('tabAction', id, 'newWindow');
        return;
      }
      const myIndex = list.indexOf(el);
      if (targetIndex >= 0 && targetIndex !== myIndex) {
        // Optimistic DOM move, then tell the browser.
        const ref = list[targetIndex];
        if (targetIndex > myIndex) ref.after(el);
        else ref.before(el);
        const tabIndex = state.tabs.findIndex((t) => t.id === Number(ref.dataset.id));
        send('moveTab', id, tabIndex);
      }
      ev.preventDefault();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}

let horizontal;
let vertical;

export function initTabs() {
  horizontal = new TabList($('#tabstrip'), { vertical: false });

  const sidebar = $('#sidebar');
  const pinned = h('div.vt-pinned');
  const newBtn = h('button.vt-new', { title: 'New tab' }, h('span', { html: icon('plus', 16) }), h('span', {}, 'New tab'));
  newBtn.addEventListener('click', () => send('newTab'));
  const list = h('div.vt-list', { role: 'tablist', 'aria-orientation': 'vertical' });
  sidebar.append(pinned, newBtn, list);
  vertical = new TabList(list, { vertical: true });
  vertical.pinnedContainer = pinned;

  const newTab = $('#new-tab');
  newTab.innerHTML = icon('plus', 18);
  newTab.addEventListener('click', () => send('newTab'));

  // Wheel scrolls the strip horizontally.
  const scroller = $('#tabstrip-scroll');
  scroller.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        scroller.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    },
    { passive: false },
  );
  // Double-click on empty strip area opens a new tab (the OS handles
  // maximize for the title-bar drag area).
  $('#tabstrip').addEventListener('dblclick', (e) => {
    if (e.target === e.currentTarget) send('newTab');
  });

  const sidebarBtn = $('#btn-sidebar');
  sidebarBtn.innerHTML = icon('sidebar', 18);
  let collapsed = false;
  try {
    collapsed = localStorage.getItem('sidebarCollapsed') === '1';
  } catch {
    /* ignore */
  }
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  sidebarBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    try {
      localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  });

  bus.on('tabs', render);
  bus.on('settings', render);
}

function render() {
  const { tabs, activeId, split } = state;
  if (state.settings.verticalTabs) vertical.render(tabs, activeId, split);
  else horizontal.render(tabs, activeId, split);
  // Keep the active tab visible in the strip.
  const activeEl = (state.settings.verticalTabs ? vertical : horizontal).els.get(activeId);
  if (activeEl && activeEl !== render.lastActiveEl) {
    render.lastActiveEl = activeEl;
    activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
