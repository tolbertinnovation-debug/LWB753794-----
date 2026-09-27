import { h, $, $$, formatBytes, faviconEl } from '/_shared/dom.js';
import { icon } from '/_shared/icons.js';
import { call, initPage } from '/_shared/page.js';

let sortKey = 'memory';
let selectedTab = null;

async function refresh() {
  const rows = await call('taskList');
  rows.sort((a, b) => (sortKey === 'title' ? String(a.title).localeCompare(b.title) : (b[sortKey] || 0) - (a[sortKey] || 0)));
  const body = $('#rows');
  body.textContent = '';
  let mem = 0;
  let cpu = 0;
  let tabs = 0;
  let sleeping = 0;
  const seenPids = new Set();
  for (const r of rows) {
    if (r.pid && !seenPids.has(r.pid)) {
      mem += r.memory;
      cpu += r.cpu;
      seenPids.add(r.pid);
    }
    if (r.kind === 'tab') tabs++;
    if (r.sleeping) sleeping++;
    const ic = r.kind === 'tab' ? faviconEl(r.favicon, r.url, 16, icon('globe', 16)) : h('span', { html: icon(r.title === 'GPU process' ? 'zap' : 'settings', 16) });
    const label = r.kind === 'tab' ? `${r.isPrivate ? 'Private tab' : 'Tab'}: ${r.title}${r.sleeping ? ' (sleeping)' : ''}` : r.title;
    const tr = h(
      `tr${r.tabId && r.tabId === selectedTab ? '.sel' : ''}`,
      {},
      h('td', {}, h('div.task', {}, ic, h('span.t', { title: r.url || r.title }, label))),
      h('td.num', {}, r.memory ? formatBytes(r.memory) : '—'),
      h('td.num', {}, r.sleeping ? '—' : `${(r.cpu || 0).toFixed(1)}%`),
      h('td.num', {}, r.pid ? String(r.pid) : '—'),
    );
    if (r.kind === 'tab') {
      tr.addEventListener('click', () => {
        selectedTab = r.tabId;
        $('#end').disabled = Boolean(r.sleeping);
        $$('tr.sel').forEach((x) => x.classList.remove('sel'));
        tr.classList.add('sel');
      });
      tr.addEventListener('dblclick', () => call('focusTab', r.tabId));
    }
    body.append(tr);
  }
  $('#summary').replaceChildren(
    h('div.card', {}, h('div.num', {}, formatBytes(mem)), h('div.lbl', {}, 'Total memory')),
    h('div.card', {}, h('div.num', {}, `${cpu.toFixed(1)}%`), h('div.lbl', {}, 'CPU')),
    h('div.card', {}, h('div.num', {}, String(tabs)), h('div.lbl', {}, 'Tabs')),
    h('div.card', {}, h('div.num', {}, String(sleeping)), h('div.lbl', {}, 'Sleeping tabs (saving memory)')),
  );
}

async function main() {
  await initPage();
  $('#title').innerHTML = `${icon('activity', 28)}Task manager`;
  $('#end').addEventListener('click', async () => {
    if (selectedTab === null) return;
    await call('endTask', selectedTab);
    selectedTab = null;
    $('#end').disabled = true;
    refresh();
  });
  $$('th[data-k]').forEach((th) =>
    th.addEventListener('click', () => {
      sortKey = th.dataset.k;
      refresh();
    }),
  );
  await refresh();
  setInterval(refresh, 2000);
}

main();
