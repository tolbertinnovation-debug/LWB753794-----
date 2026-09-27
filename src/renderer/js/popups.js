import { h, $ } from './util.js';
import { send } from './state.js';

/**
 * Popups (menus, panels, dialogs, the address-bar dropdown) must be able to
 * overlap the web page. The page is a separate native view stacked above this
 * UI, so while anything is open we ask the browser to "raise" the UI view
 * above the page. Its transparent areas keep the page visible underneath.
 */

const holders = new Set();
let raised = false;

function syncRaise() {
  const want = holders.size > 0;
  if (want !== raised) {
    raised = want;
    send('raise', want);
    document.body.classList.toggle('raised', want);
  }
}

export function holdRaise(key) {
  holders.add(key);
  syncRaise();
}

export function releaseRaise(key) {
  holders.delete(key);
  syncRaise();
}

const stack = [];

/**
 * Open a popup.
 * @param {HTMLElement} el popup content
 * @param {{ anchor?: HTMLElement|DOMRect, placement?: 'bottom-start'|'bottom-end'|'bottom-center'|'center'|'top-center',
 *           modal?: boolean, onClose?: () => void, className?: string, focus?: HTMLElement|string, offset?: number }} opts
 */
export function openPopup(el, opts = {}) {
  const layer = $('#popup-layer');
  const key = Symbol('popup');
  const backdrop = h(`div.popup-backdrop${opts.modal ? '.modal' : ''}`);
  const wrap = h(`div.popup${opts.className ? `.${opts.className}` : ''}`, { role: 'dialog' });
  wrap.append(el);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) {
      e.preventDefault();
      handle.close();
    }
  });
  backdrop.addEventListener('contextmenu', (e) => e.preventDefault());
  layer.append(backdrop, wrap);
  holdRaise(key);

  const handle = {
    el: wrap,
    closed: false,
    close(reason) {
      if (handle.closed) return;
      handle.closed = true;
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      wrap.classList.add('closing');
      backdrop.remove();
      setTimeout(() => wrap.remove(), 120);
      releaseRaise(key);
      opts.onClose?.(reason);
    },
    reposition() {
      position(wrap, opts);
    },
  };
  stack.push(handle);
  position(wrap, opts);
  requestAnimationFrame(() => wrap.classList.add('open'));
  if (opts.focus) {
    const target = typeof opts.focus === 'string' ? wrap.querySelector(opts.focus) : opts.focus;
    setTimeout(() => target?.focus(), 0);
  }
  return handle;
}

function position(wrap, opts) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  wrap.style.maxHeight = '';
  const rect = wrap.getBoundingClientRect();
  const w = rect.width;
  const hgt = rect.height;
  const gap = opts.offset ?? 6;
  let x;
  let y;
  let maxH = vh - 16;
  const placement = opts.placement || 'bottom-start';
  if (placement === 'center' || placement === 'top-center' || !opts.anchor) {
    x = (vw - w) / 2;
    y = placement === 'top-center' ? 72 : Math.max(56, (vh - hgt) / 3);
    maxH = vh - y - 16;
  } else {
    const a = opts.anchor instanceof Element ? opts.anchor.getBoundingClientRect() : opts.anchor;
    if (placement === 'bottom-end') x = a.right - w;
    else if (placement === 'bottom-center') x = a.left + a.width / 2 - w / 2;
    else x = a.left;
    const below = vh - (a.bottom + gap) - 8;
    const above = a.top - gap - 8;
    if (hgt <= below || below >= above) {
      // Stay attached below the anchor; scroll if taller than the space.
      y = a.bottom + gap;
      maxH = below;
    } else {
      maxH = above;
      y = a.top - gap - Math.min(hgt, above);
    }
  }
  x = Math.max(8, Math.min(x, vw - w - 8));
  y = Math.max(8, y);
  wrap.style.left = `${Math.round(x)}px`;
  wrap.style.top = `${Math.round(y)}px`;
  wrap.style.maxHeight = `${Math.max(120, Math.round(maxH))}px`;
}

export function closeAllPopups() {
  for (const p of [...stack]) p.close('all');
}

export function topPopup() {
  return stack[stack.length - 1] || null;
}

document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && stack.length) {
      e.preventDefault();
      e.stopPropagation();
      stack[stack.length - 1].close('escape');
    }
  },
  true,
);

window.addEventListener('blur', () => {
  // Like native menus: switching away from the window closes transient popups.
  for (const p of [...stack]) if (!p.el.classList.contains('sticky')) p.close('blur');
});

window.addEventListener('resize', () => {
  for (const p of stack) p.reposition();
});

/** Build a menu from items: { label, icon, shortcut, onClick, disabled, checked, separator, className, right } */
export function menuList(items, onPick) {
  const list = h('div.menu', { role: 'menu' });
  const buttons = [];
  for (const it of items) {
    if (!it) continue;
    if (it.separator) {
      list.append(h('div.menu-sep', { role: 'separator' }));
      continue;
    }
    if (it.custom) {
      list.append(it.custom);
      continue;
    }
    const btn = h(
      `button.menu-item${it.className ? `.${it.className}` : ''}`,
      { role: it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem', disabled: it.disabled, 'aria-checked': it.checked !== undefined ? String(Boolean(it.checked)) : undefined },
      h('span.menu-icon', { html: it.iconHtml || '' }),
      h('span.menu-label', {}, it.label),
      it.right ? it.right : null,
      it.shortcut ? h('span.menu-shortcut', {}, it.shortcut) : null,
      it.checked !== undefined ? h('span.menu-check', { html: it.checked ? '✓' : '' }) : null,
    );
    btn.addEventListener('click', (e) => {
      if (it.disabled) return;
      onPick?.(it, e);
      it.onClick?.(e);
    });
    buttons.push(btn);
    list.append(btn);
  }
  // Keyboard navigation.
  list.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(i + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      buttons[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
  });
  return list;
}
