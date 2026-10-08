import { h, $, faviconEl, debounce } from '/_shared/dom.js';
import { icon } from '/_shared/icons.js';
import { call, lib, initPage, formDialog, toast, applyTheme } from '/_shared/page.js';

const BACKGROUNDS = [
  { id: 'pan-africa', name: 'Pan-African', css: 'repeating-linear-gradient(135deg, transparent 0 38px, #ffffff04 38px 40px), radial-gradient(ellipse at 90% 100%, #bb303b55, transparent 60%), linear-gradient(150deg, #164632, #0b1911)' },
  { id: 'liberia', name: 'Liberia', css: 'radial-gradient(ellipse at 85% 90%, #bf0a3060, transparent 55%), radial-gradient(ellipse at 10% 0%, #164b92, transparent 60%), linear-gradient(145deg, #002868, #07162f)' },
  { id: 'aurora', name: 'Aurora', css: 'radial-gradient(1200px 800px at 15% 0%, #1b1446 0%, transparent 60%), linear-gradient(160deg, #0d0f24 0%, #12132b 50%, #0a1a2a 100%)' },
  { id: 'sunset', name: 'Sunset', css: 'linear-gradient(140deg, #ff9966 0%, #ff5e62 38%, #8e2de2 100%)' },
  { id: 'ocean', name: 'Ocean', css: 'linear-gradient(150deg, #0f2027 0%, #203a43 45%, #2c7a8c 100%)' },
  { id: 'forest', name: 'Forest', css: 'linear-gradient(150deg, #0b3d2e 0%, #1d6b4f 50%, #7cb36b 100%)' },
  { id: 'dusk', name: 'Dusk', css: 'linear-gradient(160deg, #1e1b4b 0%, #4c1d95 45%, #db2777 100%)' },
  { id: 'blossom', name: 'Blossom', css: 'linear-gradient(135deg, #fbc2eb 0%, #e0c3fc 45%, #a6c1ee 100%)', light: true },
  { id: 'sand', name: 'Sand', css: 'linear-gradient(160deg, #fdfcfb 0%, #f3e7d9 55%, #e2d1c3 100%)', light: true },
  { id: 'plain', name: 'Plain', css: '' },
];

let data;
let settings;

// ------------------------------------------------------------------ clock

function greetingText(name) {
  const hr = new Date().getHours();
  const part = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

function tick() {
  if (data?.isPrivate) return; // the private page has its own static header
  const now = new Date();
  const clock = $('#clock');
  if (clock) clock.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  $('#greeting').textContent = settings.ntpShowGreeting ? `${greetingText(settings.ntpName)} · ${date}` : date;
}

// -------------------------------------------------------------- background

function applyBackground() {
  const body = document.body;
  const bg = $('#bg');
  BACKGROUNDS.forEach((b) => body.classList.remove(`bg-${b.id}`));
  body.classList.remove('plain', 'light-bg');
  bg.style.removeProperty('--bg-image');
  bg.style.removeProperty('--bg-overlay');
  if (data.isPrivate) return;
  const id = settings.ntpBackground;
  if (id === 'custom' && settings.ntpCustomBackground) {
    bg.style.setProperty('--bg-image', `url("${settings.ntpCustomBackground}")`);
    bg.style.setProperty('--bg-overlay', 'linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.1) 40%, rgba(0,0,0,.4))');
    return;
  }
  const preset = BACKGROUNDS.find((b) => b.id === id) || BACKGROUNDS[0];
  body.classList.add(`bg-${preset.id}`);
  if (preset.id === 'plain') {
    body.classList.add('plain');
    bg.style.setProperty('--bg-image', 'var(--bg)');
    return;
  }
  bg.style.setProperty('--bg-image', preset.css);
  if (preset.light) body.classList.add('light-bg');
}

// ------------------------------------------------------------------ search

let items = [];
let selected = -1;
let seq = 0;

function renderSuggestions() {
  const box = $('#suggestions');
  const q = $('#q').value.trim();
  if (!q || !items.length) {
    box.hidden = true;
    document.body.classList.remove('suggesting');
    return;
  }
  box.hidden = false;
  document.body.classList.add('suggesting');
  box.textContent = '';
  items.forEach((it, i) => {
    const ic = h('span.ic');
    if (it.favicon) ic.append(faviconEl(it.favicon, it.url, 16, icon('globe', 16)));
    else ic.innerHTML = icon({ search: 'search', suggest: 'search', history: 'history', bookmark: 'star', tab: 'layers', calc: 'calc', keyword: 'zap', hint: 'zap' }[it.type] || 'globe', 16);
    const row = h(`div.sugg${i === selected ? '.selected' : ''}`, { role: 'option' }, ic, h('span.t', {}, it.title), it.subtitle && it.subtitle !== it.title ? h('span.s', {}, `— ${it.subtitle}`) : null);
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.addEventListener('click', () => go(it));
    box.append(row);
  });
}

const fetchRemote = debounce(async (q, my) => {
  const remote = await call('suggestRemote', q).catch(() => []);
  if (my !== seq) return;
  const known = new Set(items.map((i) => i.title.toLowerCase()));
  items.splice(1, 0, ...remote.filter((r) => !known.has(r.title.toLowerCase())).slice(0, 4));
  items = items.slice(0, 8);
  renderSuggestions();
}, 140);

async function suggest() {
  const q = $('#q').value;
  const my = ++seq;
  selected = -1;
  if (!q.trim()) {
    items = [];
    renderSuggestions();
    return;
  }
  const res = await call('suggest', q).catch(() => null);
  if (my !== seq || !res) return;
  items = res.items.filter((i) => i.type !== 'hint').slice(0, 8);
  renderSuggestions();
  fetchRemote(q, my);
}

function go(item) {
  if (item.type === 'calc') {
    navigator.clipboard?.writeText(item.value.replace(/,/g, '')).catch(() => {});
    toast(`Copied ${item.value}`);
    return;
  }
  if (item.type === 'tab') {
    call('openUrl', item.url, 'current');
    return;
  }
  if (items[0] === item && (item.type === 'search' || item.type === 'url' || item.type === 'keyword')) call('navigate', $('#q').value);
  else call('openUrl', item.url, 'current');
}

function initSearch() {
  const q = $('#q');
  $('#search-icon').innerHTML = icon('search', 20);
  q.placeholder = data.isPrivate ? `Search privately with ${data.searchEngineName}` : `Search ${data.searchEngineName} or type a URL`;
  q.addEventListener('input', suggest);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      selected = (selected + 1) % items.length;
      renderSuggestions();
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault();
      selected = selected <= 0 ? items.length - 1 : selected - 1;
      renderSuggestions();
    } else if (e.key === 'Escape') {
      items = [];
      renderSuggestions();
    }
  });
  q.addEventListener('blur', () => setTimeout(() => {
    items = [];
    renderSuggestions();
  }, 100));
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    if (selected >= 0 && items[selected]) go(items[selected]);
    else if (q.value.trim()) call('navigate', q.value);
  });
}

// ------------------------------------------------------------------- tiles

function tile({ url, title, favicon, pinned, onRemove }) {
  const a = h('a.tile', { href: url, title: `${title}\n${url}`, draggable: 'false' });
  const ic = h('span.tile-icon', {}, faviconEl(favicon || faviconGuess(url), url, 28));
  a.append(ic, h('span.tile-title', {}, title));
  const rm = h('button.tile-remove', { title: pinned ? 'Remove shortcut' : "Don't show on this page", 'aria-label': 'Remove', html: icon('x', 12) });
  rm.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onRemove();
  });
  a.append(rm);
  a.addEventListener('click', (e) => {
    e.preventDefault();
    call('openUrl', url, e.ctrlKey || e.metaKey || e.button === 1 ? 'background' : 'current');
  });
  a.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      call('openUrl', url, 'background');
    }
  });
  return a;
}

/** Most sites serve /favicon.ico; used when history has no icon yet. */
function faviconGuess(url) {
  try {
    const u = new URL(url);
    if (/^https?:$/.test(u.protocol)) return `${u.origin}/favicon.ico`;
  } catch {
    /* ignore */
  }
  return '';
}

function renderTiles() {
  const host = $('#tiles');
  host.textContent = '';
  if (data.isPrivate) return;
  const quick = data.quickLinks || [];
  const quickUrls = new Set(quick.map((q) => q.url.replace(/\/$/, '')));
  const top = (data.topSites || []).filter((t) => !quickUrls.has(t.url.replace(/\/$/, '')));
  const list = [
    ...quick.map((q) => ({ ...q, pinned: true, onRemove: async () => {
      await call('removeQuickLink', q.url);
      refresh();
    } })),
    ...top.map((t) => ({ ...t, onRemove: async () => {
      await call('hideTopSite', t.host);
      toast(`${t.host} won't be shown here`);
      refresh();
    } })),
  ].slice(0, 12);
  list.forEach((t, i) => {
    const el = tile(t);
    el.style.animationDelay = `${i * 25}ms`;
    host.append(el);
  });
  if (list.length < 12) {
    const add = h('a.tile.add', { href: '#', title: 'Add shortcut' }, h('span.tile-icon', { html: icon('plus', 22) }), h('span.tile-title', {}, 'Add shortcut'));
    add.addEventListener('click', async (e) => {
      e.preventDefault();
      const res = await formDialog({
        title: 'Add shortcut',
        fields: [
          { name: 'title', label: 'Name', placeholder: 'e.g. Weather' },
          { name: 'url', label: 'URL', placeholder: 'example.com' },
        ],
        submit: 'Add',
      });
      if (!res || !res.url) return;
      const ok = await call('addQuickLink', res);
      if (!ok) toast('That doesn’t look like a web address');
      refresh();
    });
    host.append(add);
  }
}

// ------------------------------------------------------------------ footer

function renderFooter() {
  const stats = $('#stats');
  stats.textContent = '';
  if (!data.isPrivate && settings.adblockEnabled) {
    const n = data.blockedTotal || 0;
    const minutes = Math.round((n * 0.05) / 60);
    const saved = minutes >= 60 ? `${(minutes / 60).toFixed(1)} h` : `${minutes} min`;
    stats.hidden = false;
    stats.className = 'pill link';
    stats.title = 'Open privacy settings';
    stats.innerHTML = `${icon('shieldCheck', 16)}`;
    stats.append(h('b', {}, n.toLocaleString()), h('span.dim', {}, n === 1 ? 'ad & tracker blocked' : 'ads & trackers blocked'));
    if (n > 50) stats.append(h('span.dim', {}, `· ~${saved} saved`));
    stats.onclick = () => call('openUrl', 'lib://settings/#privacy', 'current');
  } else {
    stats.hidden = true;
  }
  const recent = $('#recent');
  recent.textContent = '';
  const closed = (data.recentlyClosed || []).filter((c) => c.type === 'tab').slice(0, 3);
  recent.hidden = !closed.length;
  for (const c of closed) {
    const pill = h('button.pill.link', { title: `Reopen: ${c.title}` }, faviconEl(c.favicon, c.url, 16, icon('restore', 16)), h('span', {}, c.title.length > 28 ? `${c.title.slice(0, 27)}…` : c.title));
    pill.addEventListener('click', () => call('reopenClosedAt', c.index));
    recent.append(pill);
  }
  recent.style.display = closed.length ? 'contents' : 'none';
}

// ----------------------------------------------------------------- private

function renderPrivate() {
  const info = $('#private-info');
  info.hidden = false;
  document.body.classList.add('private');
  $('#clock').replaceWith(h('div.private-title', {}, h('span.mask', { html: icon('incognito', 30) }), 'You’re browsing privately'));
  $('#greeting').textContent = 'Other people using this device won’t see your activity.';
  info.append(
    h(
      'div.pcard',
      {},
      h('h3', { html: `${icon('check', 16)} LIB won’t save` }),
      h('ul', {}, h('li', {}, 'Your browsing history'), h('li', {}, 'Cookies and site data'), h('li', {}, 'Information entered in forms')),
    ),
    h(
      'div.pcard',
      {},
      h('h3', { html: `${icon('info', 16)} Your activity might still be visible to` }),
      h('ul', {}, h('li', {}, 'Websites you visit'), h('li', {}, 'Your employer or school'), h('li', {}, 'Your internet service provider')),
    ),
  );
  $('#top-right').hidden = true;
}

// ---------------------------------------------------------------- customize

function toggleRow(label, key) {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
  input.checked = Boolean(settings[key]);
  input.addEventListener('change', () => call('setSetting', key, input.checked));
  return h('label.drawer-row', {}, h('span.grow', {}, label), h('span.switch', {}, input));
}

function openDrawer() {
  const drawer = $('#drawer');
  if (!drawer.hidden) {
    drawer.hidden = true;
    return;
  }
  drawer.textContent = '';
  const close = h('button.icon-btn', { title: 'Close', html: icon('x', 18) });
  close.addEventListener('click', () => (drawer.hidden = true));

  const grid = h('div.bg-grid');
  for (const b of BACKGROUNDS) {
    const btn = h(`button.bg-choice${settings.ntpBackground === b.id ? '.on' : ''}${b.light || b.id === 'plain' ? '.light-label' : ''}`, { title: b.name }, b.name);
    btn.style.background = b.css || 'var(--bg-2)';
    btn.addEventListener('click', () => call('setSetting', 'ntpBackground', b.id));
    grid.append(btn);
  }
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
  const upload = h(`button.bg-choice.upload${settings.ntpBackground === 'custom' ? '.on' : ''}`, { title: 'Upload an image', html: icon('image', 18) }, 'Your photo');
  if (settings.ntpBackground === 'custom' && settings.ntpCustomBackground) {
    upload.style.backgroundImage = `url("${settings.ntpCustomBackground}")`;
    upload.textContent = '';
  }
  upload.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) {
      toast('Please choose an image under 15 MB');
      return;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const ok = await call('setCustomBackground', bytes, f.type);
    if (!ok) toast('That image format isn’t supported');
  });
  grid.append(upload, file);

  const name = h('input.input', { type: 'text', placeholder: 'Your name', value: settings.ntpName || '', maxlength: '40', style: { width: '100%' } });
  name.addEventListener('change', () => call('setSetting', 'ntpName', name.value.trim()));

  const themeSeg = h('div.segmented');
  for (const [value, label, ic] of [
    ['system', 'Auto', 'palette'],
    ['light', 'Light', 'sun'],
    ['dark', 'Dark', 'moon'],
  ]) {
    const b = h(`button${settings.theme === value ? '.on' : ''}`, { html: icon(ic, 14) }, label);
    b.addEventListener('click', () => call('setSetting', 'theme', value));
    themeSeg.append(b);
  }
  const swatches = h('div.swatches');
  for (const c of data.accents || []) {
    const s = h(`button.swatch${settings.accentColor === c ? '.on' : ''}`, { title: c, style: { background: c, color: c } });
    s.addEventListener('click', () => call('setSetting', 'accentColor', c));
    swatches.append(s);
  }
  const more = h('button.btn.ghost', {}, 'All settings');
  more.addEventListener('click', () => call('openUrl', 'lib://settings/', 'current'));
  const reset = h('button.btn.ghost', {}, 'Reset page');
  reset.addEventListener('click', async () => {
    for (const [k, v] of Object.entries({ ntpBackground: 'liberia', ntpShowClock: true, ntpShowTopSites: true, ntpShowStats: true, ntpShowGreeting: true, ntpHiddenSites: [] })) await call('setSetting', k, v);
  });
  drawer.append(
    h('div.drawer-head', {}, h('h2', {}, 'Customize'), close),
    h(
      'div.drawer-body',
      {},
      h('h3', {}, 'Background'),
      grid,
      h('h3', {}, 'Appearance'),
      h('div.drawer-row', {}, h('span.grow', {}, 'Theme'), themeSeg),
      h('div.drawer-row', {}, swatches),
      h('h3', {}, 'Show on this page'),
      toggleRow('Clock', 'ntpShowClock'),
      toggleRow('Greeting', 'ntpShowGreeting'),
      toggleRow('Shortcuts', 'ntpShowTopSites'),
      toggleRow('Privacy stats', 'ntpShowStats'),
      h('h3', {}, 'Greeting name'),
      h('div.drawer-row', {}, name),
    ),
    h('div.drawer-foot', {}, reset, more),
  );
  drawer.hidden = false;
}

// -------------------------------------------------------------------- init

function applyToggles() {
  document.body.classList.toggle('no-clock', !settings.ntpShowClock);
  document.body.classList.toggle('no-tiles', !settings.ntpShowTopSites);
  document.body.classList.toggle('no-stats', !settings.ntpShowStats);
}

async function refresh() {
  data = { ...data, ...(await call('newtabData')) };
  settings = { ...settings, ...data.settings };
  applyBackground();
  applyToggles();
  renderTiles();
  renderFooter();
  tick();
}

async function main() {
  const base = await initPage();
  settings = base.settings;
  data = { accents: base.accents, ...(await call('newtabData')) };
  settings = { ...settings, ...data.settings };
  document.title = data.isPrivate ? 'New Private Tab' : 'New Tab';
  $('#customize').innerHTML = `${icon('palette', 17)}<span>Customize</span>`;
  $('#customize').addEventListener('click', openDrawer);
  if (data.isPrivate) {
    applyTheme(true); // private windows are always dark
    renderPrivate();
  }
  initSearch();
  applyBackground();
  applyToggles();
  renderTiles();
  renderFooter();
  tick();
  setInterval(tick, 1000);
  document.body.classList.remove('loading');

  lib.on('settings', ({ key, value }) => {
    settings[key] = value;
    if (key.startsWith('ntp') || key === 'adblockEnabled' || key === 'theme' || key === 'accentColor') {
      applyBackground();
      applyToggles();
      renderTiles();
      renderFooter();
      tick();
      if (!$('#drawer').hidden) {
        $('#drawer').hidden = true;
        openDrawer();
      }
    }
  });
  // Refresh when the tab becomes visible again (new history, blocked counts).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
}

main()
  .catch((err) => console.error('New Tab failed to initialize', err))
  .finally(() => document.body.classList.remove('loading'));
