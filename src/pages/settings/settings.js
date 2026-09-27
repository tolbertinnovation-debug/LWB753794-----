import { h, $, $$ } from '/_shared/dom.js';
import { icon } from '/_shared/icons.js';
import { call, lib, initPage, toast, confirmDialog, timeAgo } from '/_shared/page.js';

let S; // settings
let meta; // engines, accents, keywords, platform

const SECTIONS = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'search', label: 'Search engine', icon: 'search' },
  { id: 'privacy', label: 'Privacy & security', icon: 'shield' },
  { id: 'performance', label: 'Performance', icon: 'zap' },
  { id: 'downloads', label: 'Downloads', icon: 'download' },
  { id: 'languages', label: 'Languages', icon: 'translate' },
  { id: 'reset', label: 'Reset', icon: 'restore' },
];

// ------------------------------------------------------------------ controls

function set(key, value) {
  S[key] = value;
  return call('setSetting', key, value).then((ok) => {
    if (!ok) toast('That value isn’t valid');
    return ok;
  });
}

function toggle(key, { onChange } = {}) {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = Boolean(S[key]);
  input.addEventListener('change', () => {
    set(key, input.checked);
    onChange?.(input.checked);
  });
  return h('label.switch', {}, input);
}

function select(key, options, { cast = (v) => v } = {}) {
  const sel = h('select.select', {}, ...options.map(([v, label]) => h('option', { value: String(v) }, label)));
  sel.value = String(S[key]);
  sel.addEventListener('change', () => set(key, cast(sel.value)));
  return sel;
}

function segmented(key, options) {
  const seg = h('div.segmented', { role: 'radiogroup' });
  const render = () => {
    seg.textContent = '';
    for (const [value, label, ic] of options) {
      const b = h(`button${S[key] === value ? '.on' : ''}`, { role: 'radio', 'aria-checked': String(S[key] === value), html: ic ? icon(ic, 14) : '' }, label);
      b.addEventListener('click', async () => {
        await set(key, value);
        render();
      });
      seg.append(b);
    }
  };
  render();
  return seg;
}

function row(title, desc, control, extra = {}) {
  return h(`div.setting${extra.sub ? '.sub' : ''}`, { 'data-search': `${title} ${desc || ''} ${extra.keywords || ''}`.toLowerCase() }, h('div.label', {}, h('div.title', {}, title), desc ? h('div.desc', {}, desc) : null), control ? h('div.control', {}, control) : null);
}

function section(id, title, desc, ...rows) {
  const s = SECTIONS.find((x) => x.id === id);
  return h(
    'section.card',
    { id },
    h('div.card-head', {}, h('h2.section-title', {}, h('span.ic', { html: icon(s.icon, 18) }), title), desc ? h('p', {}, desc) : null),
    h('div.card-body', {}, ...rows),
  );
}

// ------------------------------------------------------------------ sections

function generalSection(defaultStatus) {
  const homepage = h('input.input', { type: 'text', value: S.homepage, spellcheck: 'false', style: { width: '280px' } });
  homepage.addEventListener('change', () => set('homepage', homepage.value.trim() || 'lib://newtab/'));
  const defaultCtl = defaultStatus.isDefault
    ? h('span.default-status', { html: `${icon('check', 16)} LIB is your default browser` })
    : (() => {
        const b = h('button.btn.primary', {}, 'Make default');
        b.addEventListener('click', async () => {
          await call('makeDefaultBrowser');
          toast(meta.platform === 'win32' ? 'Choose LIB Browser under “Web browser” in Windows Settings' : 'LIB Browser is now your default browser');
        });
        return b;
      })();
  return section(
    'general',
    'General',
    null,
    row('Default browser', 'Open links from other apps in LIB Browser.', defaultCtl, { keywords: 'default' }),
    row(
      'On startup',
      'What to show when LIB Browser starts.',
      segmented('startup', [
        ['restore', 'Continue where I left off'],
        ['newtab', 'New tab'],
        ['homepage', 'Home page'],
      ]),
    ),
    row('Home page', 'Opened by the Home button and at startup (if selected).', homepage),
    row('Show Home button', 'Adds a Home button to the toolbar.', toggle('showHomeButton')),
    row('Show bookmarks bar', 'Ctrl+Shift+B toggles it anytime.', toggle('showBookmarksBar')),
    row('Close window with last tab', 'When off, closing the last tab opens a new tab instead.', toggle('closeWindowWithLastTab')),
  );
}

function appearanceSection() {
  const swatches = h('div.swatches');
  const renderSwatches = () => {
    swatches.textContent = '';
    for (const c of meta.accents) {
      const s = h(`button.swatch${S.accentColor === c ? '.on' : ''}`, { title: c, 'aria-label': `Accent ${c}`, style: { background: c, color: c } });
      s.addEventListener('click', async () => {
        await set('accentColor', c);
        renderSwatches();
      });
      swatches.append(s);
    }
    const custom = h('input', { type: 'color', value: S.accentColor, title: 'Custom color', style: { width: '30px', height: '28px', border: '0', background: 'transparent', cursor: 'pointer' } });
    custom.addEventListener('change', async () => {
      await set('accentColor', custom.value);
      renderSwatches();
    });
    swatches.append(custom);
  };
  renderSwatches();
  return section(
    'appearance',
    'Appearance',
    null,
    row(
      'Theme',
      'Websites that support dark mode follow this too.',
      segmented('theme', [
        ['system', 'Auto', 'palette'],
        ['light', 'Light', 'sun'],
        ['dark', 'Dark', 'moon'],
      ]),
      { keywords: 'dark mode light' },
    ),
    row('Accent color', 'Used for highlights, buttons and the address bar.', swatches, { keywords: 'color colour' }),
    row('Vertical tabs', 'Show tabs in a sidebar on the left — great for many tabs.', toggle('verticalTabs'), { keywords: 'sidebar' }),
    row('Compact mode', 'Smaller tab strip and toolbar for more page space.', toggle('compactMode'), { keywords: 'density' }),
    row(
      'Default page zoom',
      'Per-site zoom levels you set are remembered separately.',
      select(
        'defaultZoom',
        [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map((z) => [z, `${Math.round(z * 100)}%`]),
        { cast: Number },
      ),
      { keywords: 'zoom size' },
    ),
  );
}

function searchSection() {
  const engines = [...meta.searchEngines.map((e) => [e.id, e.name]), ['custom', 'Custom…']];
  const customRow = row('Custom search URL', 'Use %s where the search terms go, e.g. https://example.com/search?q=%s', null, { sub: true });
  const customInput = h('input.input', { type: 'text', value: S.customSearchUrl, placeholder: 'https://example.com/search?q=%s', spellcheck: 'false', style: { width: '320px' } });
  customInput.addEventListener('change', () => set('customSearchUrl', customInput.value.trim()));
  customRow.append(h('div.control', {}, customInput));
  customRow.hidden = S.searchEngine !== 'custom';
  const engineSel = select('searchEngine', engines);
  engineSel.addEventListener('change', () => {
    customRow.hidden = engineSel.value !== 'custom';
  });
  const kwTable = h('table.kw-table');
  for (const k of meta.keywords) {
    kwTable.append(h('tr', {}, h('td', {}, h('span.kbd', {}, k.bangOnly ? `!${k.keyword}` : k.keyword)), h('td', {}, k.name), h('td', { style: { color: 'var(--text-3)' } }, `${k.bangOnly ? '!' : ''}${k.keyword} your search`)));
  }
  const kwWrap = h('details', {}, h('summary', { style: { cursor: 'pointer', padding: '8px 12px', fontWeight: 600 } }, `Search shortcuts (${meta.keywords.length})`), kwTable);
  return section(
    'search',
    'Search engine',
    'Type in the address bar to search. Add “!” shortcuts to search a specific site, like “!w Einstein” or “yt lofi”.',
    row('Search engine used in the address bar', null, engineSel, { keywords: 'google duckduckgo bing brave ecosia startpage' }),
    customRow,
    row('Show search suggestions', 'Suggestions are fetched without cookies.', toggle('searchSuggestions'), { keywords: 'autocomplete' }),
    h('div.setting', { 'data-search': 'keywords shortcuts bang' }, h('div.label', {}, kwWrap)),
  );
}

async function privacySection() {
  const info = await call('adblockInfo');
  const perms = await call('sitePermissions');
  const statsGrid = h(
    'div.stat-grid',
    {},
    h('div.stat-card', {}, h('div.num', {}, (info.total || 0).toLocaleString()), h('div.lbl', {}, 'Ads & trackers blocked')),
    h('div.stat-card', {}, h('div.num', {}, `~${Math.round(((info.total || 0) * 0.05) / 60).toLocaleString()} min`), h('div.lbl', {}, 'Time saved loading pages')),
    h('div.stat-card', {}, h('div.num', {}, info.updatedAt ? timeAgo(info.updatedAt) : '—'), h('div.lbl', {}, info.status === 'ready' ? 'Filter lists updated' : info.status === 'loading' ? 'Loading filter lists…' : 'Filter lists unavailable')),
  );
  const update = h('button.btn', {}, 'Update now');
  update.addEventListener('click', async () => {
    update.disabled = true;
    update.textContent = 'Updating…';
    const res = await call('adblockUpdate');
    update.disabled = false;
    update.textContent = 'Update now';
    toast(res.ok ? 'Filter lists are up to date' : `Couldn’t update: ${res.error}`);
  });

  const allowChips = h('div.chips');
  const renderAllow = () => {
    allowChips.textContent = '';
    if (!S.adblockAllowlist.length) allowChips.append(h('span', { style: { color: 'var(--text-3)' } }, 'None — blocking works on every site.'));
    for (const host of S.adblockAllowlist) {
      const x = h('button', { title: 'Remove', html: icon('x', 12) });
      x.addEventListener('click', async () => {
        await set('adblockAllowlist', S.adblockAllowlist.filter((h2) => h2 !== host));
        renderAllow();
      });
      allowChips.append(h('span.chip', {}, host, x));
    }
  };
  renderAllow();

  const httpsChips = h('div.chips');
  const renderHttps = () => {
    httpsChips.textContent = '';
    if (!S.httpsExceptions.length) httpsChips.append(h('span', { style: { color: 'var(--text-3)' } }, 'None'));
    for (const host of S.httpsExceptions) {
      const x = h('button', { title: 'Remove', html: icon('x', 12) });
      x.addEventListener('click', async () => {
        await set('httpsExceptions', S.httpsExceptions.filter((h2) => h2 !== host));
        renderHttps();
      });
      httpsChips.append(h('span.chip', {}, host, x));
    }
  };
  renderHttps();

  const permList = h('div');
  const renderPerms = (list) => {
    permList.textContent = '';
    if (!list.length) permList.append(h('div.setting', {}, h('div.label', {}, h('div.desc', {}, 'No sites have been granted or denied permissions yet.'))));
    for (const site of list) {
      const box = h('div.perm-site', {}, h('div.origin', { html: icon('globe', 16) }, site.origin));
      for (const p of site.perms) {
        const sel = h('select.select', {}, h('option', { value: 'allow' }, 'Allow'), h('option', { value: 'block' }, 'Block'), h('option', { value: 'ask' }, 'Ask (reset)'));
        sel.value = p.value;
        sel.addEventListener('change', async () => {
          await call('setSitePermission', site.origin, p.key, sel.value);
          renderPerms(await call('sitePermissions'));
        });
        box.append(h('div.perm', {}, p.label, sel));
      }
      permList.append(box);
    }
  };
  renderPerms(perms);

  const clearBtn = h('button.btn.primary', { html: icon('broom', 16) }, 'Clear browsing data…');
  clearBtn.addEventListener('click', openClearDialog);

  return section(
    'privacy',
    'Privacy & security',
    'LIB blocks ads, trackers and fingerprinting scripts out of the box.',
    row('Block ads & trackers', 'Uses EasyList, EasyPrivacy and uBlock Origin filter lists.', toggle('adblockEnabled'), { keywords: 'adblock shield' }),
    statsGrid,
    row('Filter lists', 'Updated automatically every few days.', update, { sub: true, keywords: 'adblock update' }),
    row('Sites where ads are allowed', null, allowChips, { sub: true, keywords: 'allowlist whitelist adblock' }),
    row('HTTPS-Only mode', 'Always use secure connections; warn before loading insecure sites.', toggle('httpsOnly'), { keywords: 'https secure ssl' }),
    row('HTTPS-Only exceptions', null, httpsChips, { sub: true, keywords: 'https' }),
    row('Send “Do Not Track”', 'Ask websites not to track you.', toggle('doNotTrack'), { keywords: 'dnt' }),
    row('Global Privacy Control', 'Tell websites not to sell or share your data (legally binding in some places).', toggle('globalPrivacyControl'), { keywords: 'gpc sell' }),
    row('Block third-party cookies', 'Stops cross-site tracking cookies. Some sign-ins or embeds may break.', toggle('blockThirdPartyCookies'), { keywords: 'cookies cross-site' }),
    row('Clear history and cookies when LIB closes', null, toggle('clearOnExit'), { keywords: 'exit clear' }),
    row('Clear browsing data', 'History, cookies, cache and downloads list.', clearBtn, { keywords: 'clear delete cache cookies history' }),
    h('div.setting', { 'data-search': 'permissions camera microphone location notifications site' }, h('div.label', {}, h('div.title', {}, 'Site permissions'), h('div.desc', {}, 'Camera, microphone, location, notifications and more.'))),
    permList,
  );
}

function performanceSection() {
  return section(
    'performance',
    'Performance',
    null,
    row('Tab sleeping', 'Put tabs you haven’t used in a while to sleep to free memory. They wake instantly when you click them.', toggle('tabSleepEnabled'), { keywords: 'memory saver' }),
    row(
      'Put tabs to sleep after',
      null,
      select(
        'tabSleepMinutes',
        [5, 15, 30, 60, 120, 240].map((m) => [m, m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`]),
        { cast: Number },
      ),
      { sub: true },
    ),
  );
}

function downloadsSection() {
  const path = h('span.path', { title: S.downloadDir }, S.downloadDir);
  const change = h('button.btn', {}, 'Change');
  change.addEventListener('click', async () => {
    const dir = await call('chooseDownloadDir');
    if (dir) {
      S.downloadDir = dir;
      path.textContent = dir;
      path.title = dir;
    }
  });
  return section(
    'downloads',
    'Downloads',
    null,
    row('Location', null, h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, path, change), { keywords: 'folder' }),
    row('Ask where to save each file', null, toggle('askWhereToSave')),
  );
}

function languagesSection() {
  return section('languages', 'Languages', null, row('Check spelling as you type', 'Uses your system’s spell checker where available.', toggle('spellcheck'), { keywords: 'spellcheck' }));
}

function resetSection() {
  const reset = h('button.btn.danger', {}, 'Reset settings');
  reset.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Reset settings?', message: 'This restores all settings to their defaults. Your history, bookmarks and passwords are not affected.', confirm: 'Reset', danger: true });
    if (!ok) return;
    await call('resetSettings');
    location.reload();
  });
  const about = h('button.btn', {}, 'About LIB Browser');
  about.addEventListener('click', () => call('openUrl', 'lib://about/', 'current'));
  return section('reset', 'Reset', null, row('Restore settings to their original defaults', null, reset), row('Version and credits', null, about));
}

// ---------------------------------------------------------- clear data dialog

function openClearDialog() {
  const range = h(
    'select.select',
    {},
    h('option', { value: 'hour' }, 'Last hour'),
    h('option', { value: 'day' }, 'Last 24 hours'),
    h('option', { value: 'week' }, 'Last 7 days'),
    h('option', { value: 'month' }, 'Last 4 weeks'),
    h('option', { value: 'all', selected: true }, 'All time'),
  );
  const check = (name, label, checked, note) => {
    const input = h('input.checkbox', { type: 'checkbox', name });
    input.checked = checked;
    return [h('label', {}, input, label), note ? h('div.note', {}, note) : null];
  };
  const opts = h(
    'div.clear-options',
    {},
    ...check('history', 'Browsing history', true),
    ...check('cookies', 'Cookies and other site data', true, 'Signs you out of most sites. Always cleared for all time.'),
    ...check('cache', 'Cached images and files', true),
    ...check('downloads', 'Download history', false, 'Files you downloaded are not deleted.'),
    ...check('sitePrefs', 'Site settings (permissions, zoom)', false),
  );
  const ok = h('button.btn.danger.solid', {}, 'Clear data');
  const cancel = h('button.btn', {}, 'Cancel');
  const modal = h('div.modal', { role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, 'Clear browsing data'), h('div.field', { style: { display: 'flex', gap: '10px', alignItems: 'center', margin: '8px 0 12px' } }, h('span', {}, 'Time range'), range), opts, h('div.actions', {}, cancel, ok));
  const backdrop = h('div.modal-backdrop', {}, modal);
  const close = () => backdrop.remove();
  cancel.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => e.target === backdrop && close());
  modal.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  ok.addEventListener('click', async () => {
    const payload = { range: range.value };
    for (const input of $$('input', opts)) payload[input.name] = input.checked;
    ok.disabled = true;
    ok.textContent = 'Clearing…';
    await call('clearBrowsingData', payload);
    close();
    toast('Browsing data cleared');
  });
  document.body.append(backdrop);
  ok.focus();
}

// --------------------------------------------------------------------- init

function initNav() {
  const nav = $('#nav');
  nav.append(h('div.brand', { html: `<svg width="26" height="26" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset=".55" stop-color="#6366f1"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><path d="M24 17v30h19" fill="none" stroke="#fff" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="43.5" cy="21.5" r="5.2" fill="#fff"/></svg><span>Settings</span>` }));
  for (const s of SECTIONS) {
    const a = h('a.nav-item', { href: `#${s.id}`, 'data-id': s.id, html: icon(s.icon, 18) }, s.label);
    nav.append(a);
  }
  nav.append(h('div', { style: { flex: 1 } }));
  for (const [label, page, ic] of [
    ['History', 'history', 'history'],
    ['Bookmarks', 'bookmarks', 'star'],
    ['Downloads', 'downloads', 'download'],
    ['Keyboard shortcuts', 'shortcuts', 'keyboard'],
    ['About LIB', 'about', 'info'],
  ]) {
    nav.append(h('a.nav-item', { href: `lib://${page}/`, html: icon(ic, 18) }, label));
  }
  const setActive = () => {
    const id = (location.hash || '#general').slice(1);
    $$('.nav-item[data-id]').forEach((a) => a.classList.toggle('active', a.dataset.id === id));
  };
  window.addEventListener('hashchange', setActive);
  setActive();
  // Highlight the section in view while scrolling.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) $$('.nav-item[data-id]').forEach((a) => a.classList.toggle('active', a.dataset.id === e.target.id));
      }
    },
    { rootMargin: '-20% 0px -70% 0px' },
  );
  $$('section.card').forEach((s) => observer.observe(s));
}

function initFilter() {
  const input = $('#filter');
  $('#search-icon').innerHTML = icon('search', 17);
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let any = false;
    for (const sec of $$('section.card')) {
      let secAny = false;
      for (const r of $$('.setting', sec)) {
        const match = !q || (r.dataset.search || '').includes(q);
        r.classList.toggle('hidden-by-filter', !match);
        if (match) secAny = true;
      }
      const titleMatch = q && sec.querySelector('h2').textContent.toLowerCase().includes(q);
      if (titleMatch) $$('.setting', sec).forEach((r) => r.classList.remove('hidden-by-filter'));
      sec.classList.toggle('hidden-by-filter', !secAny && !titleMatch);
      if (secAny || titleMatch) any = true;
    }
    $('#no-results').hidden = any;
  });
}

async function main() {
  const data = await initPage();
  S = data.settings;
  meta = data;
  const defaultStatus = await call('defaultBrowserStatus');
  const sections = $('#sections');
  sections.append(generalSection(defaultStatus), appearanceSection(), searchSection(), await privacySection(), performanceSection(), downloadsSection(), languagesSection(), resetSection());
  initNav();
  initFilter();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  lib.on('open-section', (name) => {
    if (name === 'clear') {
      document.getElementById('privacy')?.scrollIntoView();
      openClearDialog();
    }
  });
  lib.on('settings', ({ key, value }) => {
    S[key] = value;
  });
}

main();
