import { h, $, debounce, faviconEl } from './util.js';
import { icon, logo } from './icons.js';
import { state, bus, invoke, send, activeTab } from './state.js';
import { holdRaise, releaseRaise } from './popups.js';
import { toast } from './toast.js';

const input = () => $('#url-input');
const box = () => $('#omnibox');

let focused = false;
let typed = ''; // text the user typed (without inline completion)
let results = { input: '', inline: null, items: [] };
let remote = [];
let selected = -1; // -1 → default action
let inlineActive = false;
let lastWasDelete = false;
let composing = false;
let dropdown = null;
let requestSeq = 0;
let editedTabId = null;
let justFocusedByMouse = false;

const TYPE_ICONS = {
  search: 'search',
  suggest: 'search',
  url: 'globe',
  history: 'history',
  bookmark: 'star',
  tab: 'layers',
  calc: 'calc',
  keyword: 'zap',
  hint: 'zap',
};

// ------------------------------------------------------------------ display

function formatUrlParts(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      let rest = `${u.pathname}${u.search}${u.hash}`;
      try {
        rest = decodeURI(rest);
      } catch {
        /* keep */
      }
      if (rest === '/') rest = '';
      return { scheme: u.protocol === 'http:' ? 'http://' : '', host: u.host, rest, insecure: u.protocol === 'http:' };
    }
  } catch {
    /* not a URL */
  }
  return { scheme: '', host: '', rest: url, insecure: false };
}

function isNewTab(url) {
  return !url || url.startsWith('lib://newtab');
}

function fullUrlForEditing(url) {
  if (isNewTab(url)) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return decodeURI(url);
  } catch {
    /* ignore */
  }
  return url;
}

function renderDisplay() {
  const t = activeTab();
  const inp = input();
  const display = $('#url-display');
  const engine = state.settings.searchEngineName || 'the web';
  inp.placeholder = state.isPrivate ? `Search privately with ${engine} or type a URL` : `Search ${engine} or type a URL`;
  if (focused) return;
  const url = t ? t.url : '';
  inp.value = fullUrlForEditing(url);
  display.textContent = '';
  if (!url || isNewTab(url)) return;
  if (t.errorCode === 0 && t.isReader) {
    // Reader view: show the article's original address.
    try {
      const orig = new URL(url).searchParams.get('url');
      if (orig) {
        const p = formatUrlParts(orig);
        display.append(h('span.host', {}, p.host), h('span', {}, p.rest));
        return;
      }
    } catch {
      /* fall through */
    }
  }
  const p = formatUrlParts(url);
  if (p.scheme) display.append(h(`span.scheme${p.insecure ? '.insecure' : ''}`, {}, p.scheme));
  if (p.host) display.append(h('span.host', {}, p.host));
  display.append(h('span', {}, p.rest));
}

function renderChip() {
  const chip = $('#site-chip');
  const t = activeTab();
  chip.className = '';
  chip.textContent = '';
  if (focused || !t || isNewTab(t.url)) {
    chip.innerHTML = icon('search', 16);
    chip.title = 'Search or type a URL';
    return;
  }
  let label = '';
  let html;
  switch (t.security) {
    case 'secure':
      html = icon('lock', 15);
      chip.title = 'Connection is secure — view site information';
      break;
    case 'insecure':
      html = icon('alert', 15);
      label = 'Not secure';
      chip.classList.add('insecure');
      chip.title = 'Your connection to this site is not secure';
      break;
    case 'dangerous':
      html = icon('alert', 15);
      label = 'Dangerous';
      chip.classList.add('dangerous');
      chip.title = 'This site’s certificate is not trusted';
      break;
    case 'internal':
      html = logo(16);
      label = t.isReader ? 'Reader' : 'LIB';
      chip.classList.add('internal');
      chip.title = 'LIB Browser page';
      break;
    case 'file':
      html = icon('file', 15);
      label = 'File';
      chip.title = 'Local or shared file';
      break;
    default:
      html = icon('info', 15);
      chip.title = 'View site information';
  }
  chip.innerHTML = html;
  if (label) chip.append(h('span.chip-label', {}, label));
}

function renderActions() {
  const t = activeTab();
  const star = $('#btn-star');
  const bookmarkable = t && /^(https?|file):/.test(t.url);
  star.hidden = !bookmarkable || focused;
  star.classList.toggle('active', Boolean(t?.bookmarked));
  star.title = t?.bookmarked ? 'Edit bookmark (Ctrl+D)' : 'Bookmark this tab (Ctrl+D)';

  const shield = $('#btn-shield');
  const http = t && /^https?:/.test(t.url);
  shield.hidden = !http || focused;
  if (http) {
    const on = state.settings.adblockEnabled && !t.adblockOff;
    shield.classList.toggle('has-blocked', on && t.blocked > 0);
    shield.classList.toggle('off', !state.settings.adblockEnabled);
    shield.innerHTML = icon(state.settings.adblockEnabled ? 'shieldCheck' : 'shieldOff', 16) + (t.blocked > 0 ? `<span>${t.blocked > 999 ? '999+' : t.blocked}</span>` : '');
    shield.title = state.settings.adblockEnabled ? `${t.blocked} ads & trackers blocked on this page` : 'Ad & tracker blocking is off';
  }

  const reader = $('#btn-reader');
  reader.hidden = focused || !t || !(t.readerable || t.isReader);
  reader.classList.toggle('active', Boolean(t?.isReader));

  const zoom = $('#btn-zoom');
  const z = t ? Math.round((t.zoom || 1) * 100) : 100;
  zoom.hidden = focused || !t || z === 100;
  zoom.textContent = `${z}%`;

  $('#load-progress').classList.toggle('on', Boolean(t?.loading));
}

export function renderOmnibox() {
  const t = activeTab();
  // Switching tabs discards unfinished edits.
  if (focused && t && editedTabId !== null && t.id !== editedTabId) {
    input().blur();
  }
  renderDisplay();
  renderChip();
  renderActions();
}

// --------------------------------------------------------------- suggestions

function currentItems() {
  const items = [...results.items];
  if (!remote.length) return items;
  // Engine suggestions go right after the default/calc rows.
  let at = 1;
  while (at < items.length && (items[at].type === 'calc' || items[at].type === 'hint' || (items[at].type === 'search' && at === 1))) at++;
  const known = new Set(items.filter((i) => i.type === 'search' || i.type === 'suggest').map((i) => i.title.toLowerCase()));
  const extra = remote.filter((r) => !known.has(r.title.toLowerCase())).slice(0, 4);
  items.splice(at, 0, ...extra);
  return items.slice(0, 12);
}

const fetchRemote = debounce(async (text, seq) => {
  const list = await invoke('suggestRemote', text).catch(() => []);
  if (seq !== requestSeq || !focused) return;
  remote = list || [];
  renderDropdown();
}, 140);

async function requestSuggestions() {
  const text = typed;
  const seq = ++requestSeq;
  if (!text.trim()) {
    results = { input: '', inline: null, items: [] };
    remote = [];
    closeDropdown();
    return;
  }
  const res = await invoke('suggest', text, !lastWasDelete).catch(() => null);
  if (seq !== requestSeq || !focused || !res) return;
  results = res;
  if (!res.items.length) remote = [];
  applyInline();
  renderDropdown();
  fetchRemote(text, seq);
}

function applyInline() {
  const inp = input();
  inlineActive = false;
  if (lastWasDelete || composing || !results.inline) return;
  const completion = results.inline;
  if (inp.value !== typed || inp.selectionStart !== typed.length) return;
  if (!completion.toLowerCase().startsWith(typed.toLowerCase()) || completion.length <= typed.length) return;
  inp.value = typed + completion.slice(typed.length);
  inp.setSelectionRange(typed.length, inp.value.length, 'backward');
  inlineActive = true;
}

function highlight(text, query) {
  const frag = document.createDocumentFragment();
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 6);
  if (!words.length) {
    frag.append(text);
    return frag;
  }
  const lower = text.toLowerCase();
  const marks = new Array(text.length).fill(false);
  for (const w of words) {
    let i = lower.indexOf(w);
    while (i !== -1) {
      for (let k = i; k < i + w.length; k++) marks[k] = true;
      i = lower.indexOf(w, i + w.length);
    }
  }
  let buf = '';
  let bold = false;
  const flush = () => {
    if (!buf) return;
    frag.append(bold ? h('b', {}, buf) : document.createTextNode(buf));
    buf = '';
  };
  for (let i = 0; i < text.length; i++) {
    if (marks[i] !== bold) {
      flush();
      bold = marks[i];
    }
    buf += text[i];
  }
  flush();
  return frag;
}

function itemIcon(item) {
  const wrap = h('span.sugg-icon');
  if ((item.type === 'history' || item.type === 'tab' || (item.type === 'url' && item.favicon)) && item.favicon) {
    wrap.append(faviconEl(item.favicon, item.url, 16, icon(TYPE_ICONS[item.type], 16)));
  } else {
    wrap.innerHTML = icon(TYPE_ICONS[item.type] || 'globe', 16);
  }
  return wrap;
}

function renderDropdown() {
  const items = currentItems();
  if (!focused || !typed.trim() || !items.length) {
    closeDropdown();
    return;
  }
  if (!dropdown) {
    dropdown = h('div#omnibox-dropdown', { role: 'listbox' });
    dropdown.addEventListener('mousedown', (e) => e.preventDefault()); // keep input focus
    $('#popup-layer').append(dropdown);
    holdRaise('omnibox');
    box().classList.add('dropdown-open');
  }
  const r = box().getBoundingClientRect();
  dropdown.style.left = `${r.left}px`;
  dropdown.style.top = `${r.bottom}px`;
  dropdown.style.width = `${r.width}px`;
  dropdown.textContent = '';
  const query = typed.trim();
  items.forEach((item, i) => {
    const isDefault = i === 0 && selected === -1;
    const row = h(`div.sugg.${item.type}`, { role: 'option', 'aria-selected': String(i === selected || isDefault) });
    if (i === selected || isDefault) row.classList.add('selected');
    row.append(itemIcon(item));
    const text = h('span.sugg-text');
    if (item.type === 'suggest' || item.type === 'search' || item.type === 'keyword') {
      text.append(h('span.sugg-title', {}, highlight(item.title, '')));
      text.append(h('span.sugg-sub', {}, `— ${item.subtitle || `Search ${state.settings.searchEngineName}`}`));
    } else if (item.type === 'calc' || item.type === 'hint') {
      text.append(h('span.sugg-title', {}, item.title), h('span.sugg-sub', {}, item.subtitle));
    } else {
      text.append(h('span.sugg-title', {}, highlight(item.title || item.url, query)));
      if (item.subtitle && item.subtitle !== item.title) text.append(h('span.sugg-sub.url', {}, highlight(item.subtitle, query)));
    }
    row.append(text);
    if (item.type === 'tab') row.append(h('span.sugg-badge', { html: `${icon('layers', 12)}Switch to tab` }));
    if (item.type === 'calc') row.append(h('span.sugg-badge', {}, 'Copy'));
    if (item.removable) {
      const rm = h('button.sugg-remove', { title: 'Remove from history (Shift+Delete)', html: icon('x', 14) });
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        removeItem(item);
      });
      row.append(rm);
    }
    row.addEventListener('click', (e) => activate(item, e));
    row.addEventListener('auxclick', (e) => {
      if (e.button === 1) activate(item, { ...e, altKey: true, background: true });
    });
    row.addEventListener('mousemove', () => {
      if (selected !== i) {
        selected = i;
        for (const [j, el] of [...dropdown.children].entries()) el.classList.toggle('selected', j === i);
      }
    });
    dropdown.append(row);
  });
}

function closeDropdown() {
  if (!dropdown) return;
  dropdown.remove();
  dropdown = null;
  box().classList.remove('dropdown-open');
  releaseRaise('omnibox');
}

async function removeItem(item) {
  await invoke('removeHistoryUrl', item.url);
  requestSuggestions();
}

function dispositionFor(e) {
  if (!e) return 'current';
  if (e.background) return 'background';
  if (e.altKey || (e.metaKey && state.platform === 'darwin')) return 'tab';
  if (e.shiftKey) return 'window';
  return 'current';
}

function finishNavigation() {
  closeDropdown();
  focused = false;
  editedTabId = null;
  box().classList.remove('focused');
  input().blur();
  send('focusPage');
  renderOmnibox();
}

function activate(item, e) {
  const where = dispositionFor(e);
  switch (item.type) {
    case 'tab':
      send('switchToTab', item.windowId, item.tabId);
      finishNavigation();
      return;
    case 'calc':
      send('copyText', item.value.replace(/,/g, ''));
      toast(`Copied ${item.value}`);
      return;
    case 'hint': {
      const inp = input();
      inp.value = item.fill;
      typed = item.fill;
      inp.setSelectionRange(typed.length, typed.length);
      requestSuggestions();
      return;
    }
    default:
      break;
  }
  const items = currentItems();
  if (items[0] === item && !item.inline && (item.type === 'url' || item.type === 'search' || item.type === 'keyword')) {
    // What-you-typed: let the browser resolve it (keeps https→http fallback).
    send('navigate', typed, where);
  } else {
    send('openUrl', item.url, where);
  }
  finishNavigation();
}

function submit(e) {
  const items = currentItems();
  const inp = input();
  if (selected >= 0 && items[selected]) {
    activate(items[selected], e);
    return;
  }
  if (inlineActive && items[0]?.inline) {
    activate(items[0], e);
    return;
  }
  let text = inp.value.trim();
  if (!text) return;
  // Ctrl+Enter: "example" → "www.example.com"
  if (e.ctrlKey && /^[a-z0-9-]+$/i.test(text)) text = `www.${text}.com`;
  send('navigate', text, dispositionFor(e));
  finishNavigation();
}

function moveSelection(delta) {
  const items = currentItems();
  if (!items.length) return;
  const count = items.length;
  let next = selected + delta;
  if (next < -1) next = count - 1;
  if (next >= count) next = -1;
  selected = next;
  const inp = input();
  if (selected === -1) {
    inp.value = typed;
    inlineActive = false;
  } else {
    const it = items[selected];
    inp.value = it.type === 'search' || it.type === 'suggest' || it.type === 'keyword' || it.type === 'calc' || it.type === 'hint' ? (it.type === 'calc' ? typed : it.title) : fullUrlForEditing(it.url);
    inlineActive = false;
  }
  inp.setSelectionRange(inp.value.length, inp.value.length);
  renderDropdown();
}

// -------------------------------------------------------------------- setup

export function focusOmnibox(opts = {}) {
  const inp = input();
  inp.focus();
  if (typeof opts.text === 'string') {
    inp.value = opts.text;
    typed = opts.text;
    inp.setSelectionRange(typed.length, typed.length);
    if (typed.trim() && typed !== '?') requestSuggestions();
  } else {
    inp.select();
  }
}

export function initOmnibox() {
  const inp = input();

  inp.addEventListener('focus', () => {
    focused = true;
    editedTabId = state.activeId;
    box().classList.add('focused');
    const t = activeTab();
    inp.value = fullUrlForEditing(t ? t.url : '');
    typed = inp.value;
    selected = -1;
    results = { input: '', inline: null, items: [] };
    remote = [];
    renderChip();
    renderActions();
  });
  inp.addEventListener('mousedown', () => {
    justFocusedByMouse = document.activeElement !== inp;
  });
  inp.addEventListener('mouseup', (e) => {
    // First click selects everything; later clicks place the caret.
    if (justFocusedByMouse && inp.selectionStart === inp.selectionEnd) {
      e.preventDefault();
      inp.select();
    }
    justFocusedByMouse = false;
  });
  inp.addEventListener('blur', () => {
    focused = false;
    editedTabId = null;
    inlineActive = false;
    box().classList.remove('focused');
    closeDropdown();
    renderOmnibox();
  });
  inp.addEventListener('beforeinput', (e) => {
    lastWasDelete = e.inputType.startsWith('delete');
  });
  inp.addEventListener('compositionstart', () => {
    composing = true;
  });
  inp.addEventListener('compositionend', () => {
    composing = false;
  });
  inp.addEventListener('input', () => {
    typed = inp.value;
    selected = -1;
    inlineActive = false;
    requestSuggestions();
  });
  inp.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        submit(e);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveSelection(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveSelection(-1);
        break;
      case 'Tab':
        if (dropdown && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          moveSelection(e.shiftKey ? -1 : 1);
        }
        break;
      case 'Escape': {
        e.preventDefault();
        e.stopPropagation();
        const t = activeTab();
        const original = fullUrlForEditing(t ? t.url : '');
        if (dropdown) {
          closeDropdown();
          inp.value = original;
          typed = original;
          inp.select();
        } else if (inp.value !== original) {
          inp.value = original;
          typed = original;
          inp.select();
        } else {
          inp.blur();
          send('focusPage');
        }
        break;
      }
      case 'Delete':
        if (e.shiftKey && selected >= 0) {
          const item = currentItems()[selected];
          if (item?.removable) {
            e.preventDefault();
            selected = -1;
            removeItem(item);
          }
        }
        break;
      default:
        break;
    }
  });
  inp.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const hasSelection = inp.selectionStart !== inp.selectionEnd;
    send('showMenu', 'omnibox', { x: e.clientX, y: e.clientY, hasSelection, hasText: inp.value.length > 0 });
  });
  // Drop a link or text onto the address bar to open it.
  const field = $('#omnibox');
  field.addEventListener('dragover', (e) => e.preventDefault());
  field.addEventListener('drop', (e) => {
    e.preventDefault();
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (text) send('navigate', text.split('\n')[0].trim(), 'current');
  });

  $('#site-chip').addEventListener('click', () => {
    if (focused) {
      inp.select();
      return;
    }
    bus.emit('open-site-panel');
  });
  $('#btn-shield').addEventListener('click', () => bus.emit('open-site-panel'));
  $('#btn-star').innerHTML = icon('star', 17);
  $('#btn-star').addEventListener('click', () => bus.emit('bookmark-edit', {}));
  $('#btn-reader').innerHTML = icon('reader', 17);
  $('#btn-reader').addEventListener('click', () => send('command', 'reader'));
  $('#btn-zoom').addEventListener('click', () => send('zoom', 'reset'));

  bus.on('tabs', renderOmnibox);
  bus.on('settings', renderOmnibox);
  bus.on('focus-omnibox', (opts) => focusOmnibox(opts || {}));
  bus.on('omnibox-menu', (msg) => {
    inp.focus();
    if (msg.action === 'cut') document.execCommand('cut');
    else if (msg.action === 'copy') document.execCommand('copy');
    else if (msg.action === 'paste' && typeof msg.text === 'string') document.execCommand('insertText', false, msg.text.replace(/\s*\n\s*/g, ' '));
    else if (msg.action === 'selectAll') inp.select();
    else if (msg.action === 'delete') document.execCommand('delete');
    else if (msg.action === 'undo') document.execCommand('undo');
  });
  window.addEventListener('resize', () => dropdown && renderDropdown());
  renderOmnibox();
}
