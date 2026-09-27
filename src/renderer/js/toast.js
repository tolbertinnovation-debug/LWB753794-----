import { h, $ } from './util.js';
import { command } from './state.js';

let current = null;
let timer = null;

/**
 * Brief confirmation shown over the toolbar (never over the page, so it
 * doesn't need the UI raised and never blocks clicks on the website).
 * @param {string} message
 * @param {{ kind?: 'error', action?: { label: string, command: string, arg?: any } | { label: string, onClick: Function } }} [opts]
 */
export function toast(message, opts = {}) {
  const host = $('#toast-host');
  if (current) current.remove();
  clearTimeout(timer);
  const el = h(`div.toast${opts.kind === 'error' ? '.error' : ''}`, { role: 'status' }, h('span', {}, message));
  if (opts.action) {
    const b = h('button', {}, opts.action.label);
    b.addEventListener('click', () => {
      if (opts.action.onClick) opts.action.onClick();
      else command(opts.action.command, opts.action.arg);
      dismiss();
    });
    el.append(b);
  }
  host.append(el);
  current = el;
  const dismiss = () => {
    if (current !== el) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
    current = null;
  };
  timer = setTimeout(dismiss, opts.action ? 4500 : 2600);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => {
    timer = setTimeout(dismiss, 1500);
  });
}
