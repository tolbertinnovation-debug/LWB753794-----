import { h } from './util.js';
import { icon } from './icons.js';
import { state, send, activeTab } from './state.js';
import { openPopup, menuList } from './popups.js';

const isMac = () => state.platform === 'darwin';
const mod = () => (isMac() ? '⌘' : 'Ctrl+');
const shift = () => (isMac() ? '⇧' : 'Shift+');

function isDark() {
  const theme = state.settings.theme;
  return theme === 'dark' || (theme === 'system' && state.settings.systemDark);
}

/** The ⋮ menu: an HTML popup (so it can host zoom controls & toggles). */
export function openAppMenu(anchor) {
  const t = activeTab();
  const zoom = Math.round((t?.zoom || 1) * 100);
  let popup;
  const run = (id, arg) => {
    popup.close();
    send('command', id, arg);
  };

  const quick = h('div.menu-quick');
  const quickBtn = (label, iconName, on, onClick) => {
    const b = h(`button${on ? '.on' : ''}`, { html: icon(iconName, 18) }, label);
    b.addEventListener('click', onClick);
    return b;
  };
  quick.append(
    quickBtn(isDark() ? 'Light' : 'Dark', isDark() ? 'sun' : 'moon', false, () => run('toggleTheme')),
    quickBtn('Sidebar', 'sidebar', state.settings.verticalTabs, () => run('toggleVerticalTabs')),
    quickBtn('Split view', 'split', Boolean(state.split), () => run(state.split ? 'closeSplit' : 'splitView')),
    quickBtn('Screenshot', 'camera', false, () => run('screenshot')),
  );

  const zoomRow = h('div.menu-row');
  const zoomOut = h('button.icon-btn', { title: 'Zoom out', html: icon('minus', 16) });
  const zoomIn = h('button.icon-btn', { title: 'Zoom in', html: icon('plus', 16) });
  const zoomVal = h('span.zoom-value', {}, `${zoom}%`);
  const fs = h('button.icon-btn', { title: 'Full screen', html: icon('fullscreen', 16) });
  zoomOut.addEventListener('click', () => send('zoom', 'out'));
  zoomIn.addEventListener('click', () => send('zoom', 'in'));
  zoomVal.addEventListener('dblclick', () => send('zoom', 'reset'));
  fs.addEventListener('click', () => run('fullscreen'));
  zoomRow.append(h('span.menu-icon', { html: icon('zoomIn', 17) }), h('span.menu-label', {}, 'Zoom'), zoomOut, zoomVal, zoomIn, fs);
  const offZoom = window.lib.onEvent((name, payload) => {
    if (name === 'zoom') zoomVal.textContent = `${Math.round(payload.zoom * 100)}%`;
  });

  const items = [
    { custom: quick },
    { label: 'New tab', iconHtml: icon('plus', 17), shortcut: `${mod()}T`, onClick: () => run('newTab') },
    { label: 'New window', iconHtml: icon('newWindow', 17), shortcut: `${mod()}N`, onClick: () => run('newWindow') },
    { label: 'New private window', iconHtml: icon('incognito', 17), shortcut: `${mod()}${shift()}N`, onClick: () => run('newPrivateWindow') },
    { separator: true },
    { custom: zoomRow },
    { separator: true },
    { label: 'History', iconHtml: icon('history', 17), shortcut: isMac() ? '⌘Y' : 'Ctrl+H', onClick: () => run('history') },
    {
      label: 'Recently closed',
      iconHtml: icon('restore', 17),
      right: h('span.menu-shortcut', { html: icon('chevronRight', 14) }),
      onClick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        popup.close();
        send('showMenu', 'recentlyClosed', { x: r.right - 8, y: r.top });
      },
    },
    { label: 'Downloads', iconHtml: icon('download', 17), shortcut: isMac() ? '⌘⇧J' : 'Ctrl+J', onClick: () => run('downloads') },
    { label: 'Bookmarks', iconHtml: icon('star', 17), shortcut: `${mod()}${shift()}O`, onClick: () => run('bookmarksManager') },
    { label: 'Show bookmarks bar', iconHtml: icon('bookmarks', 17), checked: Boolean(state.settings.showBookmarksBar), onClick: () => run('toggleBookmarksBar') },
    { separator: true },
    { label: 'Find in page…', iconHtml: icon('search', 17), shortcut: `${mod()}F`, onClick: () => run('find') },
    { label: 'Print…', iconHtml: icon('printer', 17), shortcut: `${mod()}P`, onClick: () => run('print') },
    { label: 'Reader mode', iconHtml: icon('reader', 17), disabled: !(t?.readerable || t?.isReader), onClick: () => run('reader') },
    { label: 'Translate page', iconHtml: icon('translate', 17), disabled: !t || !/^https?:/.test(t.url), onClick: () => run('translate') },
    { label: 'Picture-in-picture', iconHtml: icon('pip', 17), disabled: !t || !/^https?:|^file:/.test(t.url), onClick: () => run('pip') },
    { label: 'Full-page screenshot', iconHtml: icon('camera', 17), onClick: () => run('fullScreenshot') },
    { separator: true },
    { label: 'Save page as PDF…', iconHtml: icon('save', 17), disabled: !t || !/^(https?|file):/.test(t.url), onClick: () => run('savePdf') },
    { label: 'Copy clean link', iconHtml: icon('copy', 17), disabled: !t || !/^https?:/.test(t.url), onClick: () => run('copyCleanUrl') },
    { label: 'Close duplicate tabs', iconHtml: icon('layers', 17), onClick: () => run('closeDuplicateTabs') },
    { label: 'Free memory: sleep background tabs', iconHtml: icon('activity', 17), onClick: () => run('sleepBackgroundTabs') },
    { label: 'Save page as…', iconHtml: icon('save', 17), shortcut: `${mod()}S`, onClick: () => run('savePage') },
    { label: 'Developer tools', iconHtml: icon('code', 17), shortcut: isMac() ? '⌥⌘I' : 'F12', onClick: () => run('devtools') },
    { label: 'Task manager', iconHtml: icon('activity', 17), shortcut: isMac() ? '' : 'Shift+Esc', onClick: () => run('taskManager') },
    { label: 'Clear browsing data…', iconHtml: icon('broom', 17), shortcut: isMac() ? '⌘⇧⌫' : 'Ctrl+Shift+Del', onClick: () => run('clearData') },
    { separator: true },
    { label: 'Settings', iconHtml: icon('settings', 17), shortcut: `${mod()},`, onClick: () => run('settings') },
    { label: 'Keyboard shortcuts', iconHtml: icon('keyboard', 17), onClick: () => run('shortcuts') },
    { label: 'About LIB Browser', iconHtml: icon('info', 17), onClick: () => run('about') },
    ...(isMac() ? [] : [{ separator: true }, { label: 'Exit', iconHtml: icon('exit', 17), onClick: () => run('quit') }]),
  ];
  const list = menuList(items);
  list.style.minWidth = '300px';
  popup = openPopup(list, { anchor, placement: 'bottom-end', onClose: offZoom });
  setTimeout(() => list.querySelector('.menu-item')?.focus({ preventScroll: true }), 0);
  return popup;
}
