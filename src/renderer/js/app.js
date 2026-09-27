import { $ } from './util.js';
import { icon } from './icons.js';
import { state, bus, invoke, send } from './state.js';
import { initTabs } from './tabs.js';
import { initOmnibox } from './omnibox.js';
import { initToolbar } from './toolbar.js';
import { initPanels } from './panels.js';
import { initPalette } from './palette.js';
import { initBookmarksBar } from './bookmarks-bar.js';
import { initFindbar } from './findbar.js';
import { initInfobars } from './infobar.js';
import { initContent } from './content.js';
import { toast } from './toast.js';
import { closeAllPopups } from './popups.js';

const params = new URLSearchParams(location.search);
state.platform = params.get('platform') || 'linux';
state.isPrivate = params.get('private') === '1';
document.body.classList.add(`platform-${state.platform}`);
if (state.isPrivate) document.body.classList.add('private');

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

function applyTheme() {
  const s = state.settings;
  const dark = state.isPrivate || s.theme === 'dark' || (s.theme === 'system' && s.systemDark);
  const body = document.body;
  body.classList.toggle('theme-dark', dark);
  body.classList.toggle('theme-light', !dark);
  body.classList.toggle('vertical-tabs', Boolean(s.verticalTabs));
  body.classList.toggle('compact', Boolean(s.compactMode));
  if (!state.isPrivate && s.accentColor) {
    body.style.setProperty('--accent', s.accentColor);
    body.style.setProperty('--accent-contrast', luminance(s.accentColor) > 0.45 ? '#111318' : '#ffffff');
  }
  // Match the native window-control buttons (Windows/Linux) to our colors.
  requestAnimationFrame(() => {
    const cs = getComputedStyle(body);
    const frame = cs.getPropertyValue('--frame').trim();
    const symbol = cs.getPropertyValue('--text-2').trim();
    const height = s.verticalTabs ? $('#toolbar').offsetHeight : $('#tabbar').offsetHeight;
    send('setTitleBarOverlay', { color: frame, symbolColor: symbol, height });
    reportLayout();
  });
}

let lastInsets = '';
function reportLayout() {
  const r = $('#content').getBoundingClientRect();
  const insets = {
    top: Math.round(r.top),
    left: Math.round(r.left),
    right: Math.round(window.innerWidth - r.right),
    bottom: Math.round(window.innerHeight - r.bottom),
  };
  const key = JSON.stringify(insets);
  if (key === lastInsets) return;
  lastInsets = key;
  send('layout', insets);
}

// Events can arrive while the UI is still initializing; replay them after.
let initialized = false;
const pending = [];

function onEvent(name, payload) {
  if (!initialized) pending.push([name, payload]);
  else handleEvent(name, payload);
}

function handleEvent(name, payload) {
  switch (name) {
    case 'tabs':
      state.tabs = payload.tabs;
      state.activeId = payload.activeId;
      state.split = payload.split;
      bus.emit('tabs');
      break;
    case 'settings':
      state.settings = payload;
      applyTheme();
      bus.emit('settings');
      requestAnimationFrame(reportLayout);
      break;
    case 'bookmarks-bar':
      state.bookmarksBar = payload;
      bus.emit('bookmarks-bar');
      break;
    case 'downloads':
      state.downloads = payload;
      bus.emit('downloads');
      break;
    case 'download-started':
      bus.emit('download-started', payload);
      toast(`Downloading ${payload.filename}`);
      break;
    case 'toast':
      toast(payload.message, payload);
      break;
    case 'layout':
      state.layout = payload;
      bus.emit('layout');
      break;
    case 'window-state':
      state.maximized = payload.maximized;
      state.fullscreen = payload.fullscreen;
      document.body.classList.toggle('maximized', payload.maximized);
      document.body.classList.toggle('fullscreen', payload.fullscreen);
      requestAnimationFrame(reportLayout);
      break;
    case 'window-focus':
      document.body.classList.toggle('window-blurred', !payload);
      break;
    case 'html-fullscreen':
      state.htmlFullscreen = payload;
      document.body.classList.toggle('html-fullscreen', payload);
      if (payload) closeAllPopups();
      break;
    case 'zoom': {
      const t = state.tabs.find((x) => x.id === payload.tabId);
      if (t) t.zoom = payload.zoom;
      bus.emit('tabs');
      break;
    }
    default:
      // Everything else is forwarded to modules as-is.
      bus.emit(name, payload);
  }
}

async function init() {
  window.lib.onEvent(onEvent);
  const initial = await invoke('ready');
  Object.assign(state, {
    windowId: initial.windowId,
    isPrivate: initial.isPrivate,
    platform: initial.platform,
    tabs: initial.tabs,
    activeId: initial.activeId,
    split: initial.split,
    settings: initial.settings,
    bookmarksBar: initial.bookmarksBar,
    downloads: initial.downloads,
    commands: initial.commands,
    maximized: initial.maximized,
    fullscreen: initial.fullscreen,
  });
  document.body.classList.toggle('fullscreen', Boolean(initial.fullscreen));
  document.body.classList.toggle('maximized', Boolean(initial.maximized));
  if (state.isPrivate) {
    const badge = $('#private-badge');
    badge.hidden = false;
    badge.innerHTML = `${icon('incognito', 15)}<span>Private</span>`;
    badge.title = 'Private window: history, cookies and site data are forgotten when you close all private windows.';
  }
  applyTheme();
  initTabs();
  initToolbar();
  initOmnibox();
  initPanels();
  initPalette();
  initBookmarksBar();
  initFindbar();
  initInfobars();
  initContent();
  bus.emit('tabs');
  bus.emit('settings');
  bus.emit('downloads');

  new ResizeObserver(reportLayout).observe($('#content'));
  window.addEventListener('resize', reportLayout);
  reportLayout();
  initialized = true;
  for (const [name, payload] of pending.splice(0)) handleEvent(name, payload);
  document.body.classList.add('ready');
}

init().catch((err) => console.error('UI init failed', err));
