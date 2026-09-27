import { h, $ } from '/_shared/dom.js';
import { icon } from '/_shared/icons.js';
import { call, initPage, toast } from '/_shared/page.js';

const FEATURES = [
  ['shieldCheck', 'Built-in ad & tracker blocking', 'Pages load faster and trackers can’t follow you — no extension needed.'],
  ['incognito', 'Private windows', 'Nothing is saved after you close them: no history, cookies or site data.'],
  ['split', 'Split view', 'Two tabs side by side in one window. Drag the divider to resize.'],
  ['command', 'Command palette', 'Ctrl+Shift+A finds any tab, bookmark, page or action instantly.'],
  ['reader', 'Reader mode', 'Clutter-free articles with adjustable fonts and themes.'],
  ['zap', 'Smart address bar', 'Calculator, search shortcuts like “!w” and “yt”, and instant suggestions.'],
  ['activity', 'Tab sleeping', 'Background tabs sleep to save memory and wake instantly.'],
  ['sidebar', 'Vertical tabs', 'Manage dozens of tabs comfortably from a sidebar.'],
  ['camera', 'Screenshots', 'Capture the visible page or the full page in one click.'],
];

async function main() {
  await initPage();
  const info = await call('appInfo');
  const rows = [
    ['Version', info.version],
    ['Chromium', info.chrome],
    ['Electron', info.electron],
    ['V8', info.v8],
    ['Platform', info.platform],
    ['Profile folder', info.userData],
  ];
  const box = $('#versions');
  for (const [k, v] of rows) {
    const code = h('code', {}, v);
    box.append(h('div.setting', {}, h('div.label', {}, h('div.title', {}, k)), h('div.control', {}, code)));
  }
  const copy = h('button.btn.small', { html: icon('copy', 14) }, 'Copy details');
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(rows.map(([k, v]) => `${k}: ${v}`).join('\n'));
    toast('Copied');
  });
  box.append(h('div.setting', {}, h('div.label'), h('div.control', {}, copy)));
  const features = $('#features');
  for (const [ic, title, desc] of FEATURES) {
    features.append(h('div.card.feature', {}, h('div.ic', { html: icon(ic, 18) }), h('h3', {}, title), h('p', {}, desc)));
  }
}

main();
