import { h, $, faviconEl, debounce, hostOf } from '/_shared/dom.js';
import { icon } from '/_shared/icons.js';
import { call, lib, initPage, confirmDialog, dayLabel, toast } from '/_shared/page.js';

const PAGE = 150;
let visits = [];
let done = false;
let loading = false;
const selected = new Set();

async function load(reset = false) {
  if (loading) return;
  if (reset) {
    visits = [];
    done = false;
  }
  if (done) return;
  loading = true;
  const before = visits.length ? visits[visits.length - 1].time : Infinity;
  const batch = await call('historyQuery', { text: $('#q').value.trim(), before, limit: PAGE });
  loading = false;
  visits.push(...batch);
  if (batch.length < PAGE) done = true;
  render();
}

function render() {
  const list = $('#list');
  list.textContent = '';
  if (!visits.length) {
    const q = $('#q').value.trim();
    list.append(
      h(
        'div.empty',
        {},
        h('div.empty-icon', { html: icon(q ? 'search' : 'history', 30) }),
        h('h2', {}, q ? 'No results' : 'Your history is empty'),
        h('p', {}, q ? `Nothing in your history matches “${q}”.` : 'Pages you visit will appear here.'),
      ),
    );
    $('#more').textContent = '';
    return;
  }
  let card = null;
  let body = null;
  let lastDay = '';
  for (const v of visits) {
    const day = new Date(v.time).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      body = h('div.card-body');
      card = h('div.card', {}, h('div.group-title', {}, dayLabel(v.time)), body);
      list.append(card);
    }
    body.append(rowFor(v));
  }
  $('#more').textContent = done ? '' : 'Loading more…';
}

function rowFor(v) {
  const cb = h('input.checkbox', { type: 'checkbox', 'aria-label': 'Select' });
  cb.checked = selected.has(v.id);
  const row = h(`div.list-row${cb.checked ? '.selected' : ''}`);
  cb.addEventListener('change', () => {
    if (cb.checked) selected.add(v.id);
    else selected.delete(v.id);
    row.classList.toggle('selected', cb.checked);
    renderSelbar();
  });
  const time = new Date(v.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const link = h('a.title', { href: v.url, title: v.url }, v.title || v.url, h('span.domain', {}, hostOf(v.url).replace(/^www\./, '')));
  link.addEventListener('click', (e) => {
    e.preventDefault();
    call('openUrl', v.url, e.ctrlKey || e.metaKey ? 'background' : e.shiftKey ? 'window' : 'current');
  });
  link.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      call('openUrl', v.url, 'background');
    }
  });
  const more = h('button.icon-btn', { title: 'Remove from history', 'aria-label': 'Remove from history', html: icon('trash', 16) });
  more.addEventListener('click', async () => {
    await call('historyDelete', [v.id]);
    visits = visits.filter((x) => x.id !== v.id);
    render();
  });
  const similar = h('button.icon-btn', { title: 'More from this site', 'aria-label': 'More from this site', html: icon('search', 16) });
  similar.addEventListener('click', () => {
    $('#q').value = hostOf(v.url);
    load(true);
  });
  row.append(cb, h('span.time', {}, time), h('span.fav-tile', {}, faviconEl(v.favicon, v.url, 16)), h('div.main-col', {}, link), h('div.actions', {}, similar, more));
  return row;
}

function renderSelbar() {
  const bar = $('#selbar');
  document.body.classList.toggle('selecting', selected.size > 0);
  bar.hidden = selected.size === 0;
  if (!selected.size) return;
  bar.textContent = '';
  const del = h('button.btn.small', { html: icon('trash', 14) }, 'Delete');
  const cancel = h('button.btn.small', {}, 'Cancel');
  del.addEventListener('click', async () => {
    await call('historyDelete', [...selected]);
    visits = visits.filter((v) => !selected.has(v.id));
    toast(`Deleted ${selected.size} item${selected.size > 1 ? 's' : ''}`);
    selected.clear();
    renderSelbar();
    render();
  });
  cancel.addEventListener('click', () => {
    selected.clear();
    renderSelbar();
    render();
  });
  bar.append(h('span', { style: { flex: 1 } }, `${selected.size} selected`), cancel, del);
}

async function main() {
  await initPage();
  $('#title').innerHTML = `${icon('history', 28)}History`;
  $('#search-icon').innerHTML = icon('search', 17);
  const clear = $('#clear');
  clear.innerHTML = `${icon('broom', 16)}Clear browsing data`;
  clear.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Clear all history?', message: 'This removes every page from your history. Cookies and cached files are kept (use Settings → Privacy to clear those).', confirm: 'Clear history', danger: true });
    if (!ok) return;
    await call('clearBrowsingData', { range: 'all', history: true });
    load(true);
  });
  $('#q').addEventListener('input', debounce(() => load(true), 150));
  window.addEventListener('scroll', () => {
    if (window.innerHeight + window.scrollY > document.body.scrollHeight - 600) load();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('#q').focus();
    }
  });
  lib.on('history', debounce(() => !selected.size && load(true), 500));
  await load(true);
}

main();
