// Small DOM + formatting helpers shared by the browser UI.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Create an element: h('div.card#main', { onclick, title }, children...)
 * Strings are text nodes; use { html } for trusted markup (icons only).
 */
export function h(tag, props = {}, ...children) {
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const part of rest) {
    if (part.startsWith('.')) el.classList.add(part.slice(1));
    else if (part.startsWith('#')) el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Tiny event emitter used as the UI store. */
export class Emitter {
  constructor() {
    this.map = new Map();
  }
  on(name, cb) {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name).add(cb);
    return () => this.map.get(name).delete(cb);
  }
  emit(name, payload) {
    for (const cb of this.map.get(name) || []) {
      try {
        cb(payload);
      } catch (err) {
        console.error(err);
      }
    }
  }
}

/** Is the element (or its ancestor) editable text? */
export function isEditable(el) {
  return el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

/** Letter avatar colour for sites without favicons. */
export function hueFor(text) {
  let hash = 0;
  for (const ch of String(text)) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

/** <img> favicon with a graceful fallback to a globe or letter avatar. */
export function faviconEl(url, pageUrl, size = 16, fallbackIcon = null) {
  const wrap = h('span.favicon', { style: { width: `${size}px`, height: `${size}px` } });
  const fallback = () => {
    wrap.textContent = '';
    if (fallbackIcon) {
      wrap.innerHTML = fallbackIcon;
      return;
    }
    const host = hostOf(pageUrl || '').replace(/^www\./, '');
    const letter = (host[0] || '•').toUpperCase();
    wrap.classList.add('letter');
    wrap.style.setProperty('--hue', hueFor(host));
    wrap.textContent = letter;
  };
  if (url && /^(https?|data|lib|file):/.test(url)) {
    const img = h('img', { src: url, width: size, height: size, alt: '', draggable: 'false', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', fallback, { once: true });
    wrap.append(img);
  } else {
    fallback();
  }
  return wrap;
}
