import { h, $ } from './util.js';
import { icon } from './icons.js';
import { bus, send } from './state.js';

const PERM_ICONS = {
  camera: 'camera',
  microphone: 'volume',
  geolocation: 'globe',
  notifications: 'info',
  'clipboard-read': 'copy',
  'display-capture': 'pip',
  openExternal: 'external',
};

function render(prompts) {
  const host = $('#infobars');
  host.textContent = '';
  for (const p of prompts || []) {
    const remember = h('input', { type: 'checkbox' });
    remember.checked = !p.noRemember;
    const block = h('button.btn', {}, 'Block');
    const allow = h('button.btn.primary', {}, 'Allow');
    const dismiss = h('button.icon-btn.small', { title: 'Dismiss', 'aria-label': 'Dismiss', html: icon('x', 15) });
    block.addEventListener('click', () => send('permissionRespond', p.id, false, remember.checked));
    allow.addEventListener('click', () => send('permissionRespond', p.id, true, remember.checked));
    dismiss.addEventListener('click', () => send('permissionRespond', p.id, false, false));
    const labels = p.items.map((i) => i.label);
    const bar = h(
      'div.infobar',
      { role: 'alertdialog', 'aria-label': `${p.host} permission request` },
      h('div.ib-icon', { html: icon(PERM_ICONS[p.items[0]?.key] || 'shield', 18) }),
      h('div.ib-text', {}, h('div', {}, h('b', {}, p.host), ' wants to'), h('div.ib-sub', {}, labels.join(' · '))),
      p.noRemember ? null : h('label', {}, remember, 'Remember'),
      block,
      allow,
      dismiss,
    );
    host.append(bar);
  }
}

export function initInfobars() {
  bus.on('permission-prompts', render);
}
