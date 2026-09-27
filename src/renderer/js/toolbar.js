import { $ } from './util.js';
import { icon } from './icons.js';
import { state, bus, send, activeTab } from './state.js';
import { openAppMenu } from './menu.js';
import { openDownloadsPanel } from './panels.js';
import { openPalette } from './palette.js';

/** Long-press (or right-click) on Back/Forward shows the history list. */
function historyButton(btn, action) {
  let timer = null;
  let longPressed = false;
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    longPressed = false;
    timer = setTimeout(() => {
      longPressed = true;
      const r = btn.getBoundingClientRect();
      send('showMenu', action, { x: r.left, y: r.bottom + 4 });
    }, 450);
  });
  const cancel = () => clearTimeout(timer);
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointerleave', cancel);
  btn.addEventListener('click', (e) => {
    if (longPressed) return;
    // Middle/ctrl-click opens the previous page in a new tab (like Chrome) —
    // simplified here to plain navigation.
    send('nav', action);
    e.preventDefault();
  });
  btn.addEventListener('auxclick', (e) => {
    if (e.button === 1) send('nav', action);
  });
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const r = btn.getBoundingClientRect();
    send('showMenu', action, { x: r.left, y: r.bottom + 4 });
  });
}

function renderNav() {
  const t = activeTab();
  $('#btn-back').disabled = !t?.canGoBack;
  $('#btn-forward').disabled = !t?.canGoForward;
  const reload = $('#btn-reload');
  const loading = Boolean(t?.loading);
  if (reload.dataset.loading !== String(loading)) {
    reload.dataset.loading = String(loading);
    reload.innerHTML = icon(loading ? 'x' : 'reload', 18);
    reload.title = loading ? 'Stop loading (Esc)' : 'Reload (Ctrl+R)';
    reload.setAttribute('aria-label', loading ? 'Stop' : 'Reload');
  }
  $('#btn-home').hidden = !state.settings.showHomeButton;
  const split = $('#btn-split');
  const inSplit = Boolean(state.split && state.split.tabIds.includes(state.activeId));
  split.hidden = !inSplit;
  split.classList.toggle('active', inSplit);
}

function renderDownloads() {
  const btn = $('#btn-downloads');
  const d = state.downloads;
  const has = d && d.recent && d.recent.length > 0;
  btn.hidden = !has;
  if (!has) return;
  const progress = d.active ? (d.progress >= 0 ? d.progress : 0.25) : 0;
  const ring = d.active
    ? `<svg class="dl-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="none" stroke="var(--line-strong)" stroke-width="2.5"/><circle cx="18" cy="18" r="16" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${(progress * 100.5).toFixed(1)} 100.5" transform="rotate(-90 18 18)"/></svg>`
    : '';
  btn.innerHTML = icon('download', d.active ? 15 : 18) + ring;
  btn.title = d.active ? `Downloading ${d.active} file${d.active > 1 ? 's' : ''}${d.progress >= 0 ? ` — ${Math.round(d.progress * 100)}%` : ''}` : 'Downloads';
  btn.classList.toggle('active', d.active > 0);
}

export function initToolbar() {
  $('#btn-back').innerHTML = icon('arrowLeft', 18);
  $('#btn-forward').innerHTML = icon('arrowRight', 18);
  $('#btn-home').innerHTML = icon('home', 18);
  $('#btn-split').innerHTML = icon('split', 18);
  $('#btn-palette').innerHTML = icon('command', 18);
  $('#btn-menu').innerHTML = icon('more', 18);
  historyButton($('#btn-back'), 'back');
  historyButton($('#btn-forward'), 'forward');
  $('#btn-reload').addEventListener('click', (e) => {
    const t = activeTab();
    if (t?.loading) send('nav', 'stop');
    else send('nav', e.shiftKey || e.ctrlKey || e.metaKey ? 'hardReload' : 'reload');
  });
  $('#btn-home').addEventListener('click', () => send('nav', 'home'));
  $('#btn-split').addEventListener('click', () => send('splitAction', 'close'));
  $('#btn-split').title = 'Exit split view';
  $('#btn-menu').addEventListener('click', () => openAppMenu($('#btn-menu')));
  $('#btn-downloads').addEventListener('click', () => openDownloadsPanel($('#btn-downloads')));
  $('#btn-palette').addEventListener('click', () => openPalette());

  bus.on('tabs', renderNav);
  bus.on('settings', renderNav);
  bus.on('downloads', renderDownloads);
  bus.on('download-started', () => {
    const btn = $('#btn-downloads');
    renderDownloads();
    btn.hidden = false;
    btn.classList.remove('bounce');
    void btn.offsetWidth;
    btn.classList.add('bounce');
  });
  renderNav();
  renderDownloads();
}
