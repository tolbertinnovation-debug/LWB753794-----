// Common bootstrap for lib:// pages: accent colour, toasts, confirm dialogs.
import { h } from './dom.js';

export const lib = window.lib;

export function call(method, ...args) {
  return lib.call(method, ...args);
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0.3;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function applyAccent(color) {
  if (!color) return;
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-contrast', luminance(color) > 0.45 ? '#111318' : '#ffffff');
}

/** Load settings once and keep the accent colour in sync. */
export async function initPage() {
  const data = await call('getSettings');
  applyAccent(data.settings.accentColor);
  lib.on('settings', ({ key, value }) => {
    if (key === 'accentColor') applyAccent(value);
  });
  return data;
}

let toastTimer;
export function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h('div.toast', { role: 'status' }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

/**
 * Promise-based confirm dialog.
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirm = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const ok = h(`button.btn${danger ? '.danger.solid' : '.primary'}`, {}, confirm);
    const cancel = h('button.btn', {}, 'Cancel');
    const backdrop = h('div.modal-backdrop', {}, h('div.modal', { role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, title), h('p', {}, message), h('div.actions', {}, cancel, ok)));
    const done = (v) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        done(false);
      }
    };
    ok.addEventListener('click', () => done(true));
    cancel.addEventListener('click', () => done(false));
    backdrop.addEventListener('mousedown', (e) => e.target === backdrop && done(false));
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    ok.focus();
  });
}

/** Prompt dialog with fields: [{ name, label, value }]. */
export function formDialog({ title, fields, submit = 'Save' }) {
  return new Promise((resolve) => {
    const inputs = fields.map((f) => h('input.input', { type: 'text', value: f.value || '', name: f.name, spellcheck: 'false', placeholder: f.placeholder || '' }));
    const ok = h('button.btn.primary', { type: 'submit' }, submit);
    const cancel = h('button.btn', { type: 'button' }, 'Cancel');
    const form = h(
      'form.modal',
      {},
      h('h2', {}, title),
      ...fields.map((f, i) => h('div.field', {}, h('label', {}, f.label), inputs[i])),
      h('div.actions', {}, cancel, ok),
    );
    const backdrop = h('div.modal-backdrop', {}, form);
    const done = (v) => {
      backdrop.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      fields.forEach((f, i) => (out[f.name] = inputs[i].value.trim()));
      done(out);
    });
    cancel.addEventListener('click', () => done(null));
    backdrop.addEventListener('mousedown', (e) => e.target === backdrop && done(null));
    form.addEventListener('keydown', (e) => e.key === 'Escape' && done(null));
    document.body.append(backdrop);
    inputs[0]?.focus();
    inputs[0]?.select();
  });
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  const date = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
  if (same(d, today)) return `Today — ${date}`;
  if (same(d, yesterday)) return `Yesterday — ${date}`;
  return date;
}
