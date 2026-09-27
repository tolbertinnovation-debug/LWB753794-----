import { h, $, formatBytes, formatDuration, hostOf, debounce } from '/_shared/dom.js';
import { icon } from '/_shared/icons.js';
import { call, lib, initPage, dayLabel } from '/_shared/page.js';

function ext(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name || '');
  return m ? m[1] : '';
}

function meta(d) {
  const from = hostOf(d.url);
  switch (d.state) {
    case 'progressing': {
      const pct = d.total ? ` of ${formatBytes(d.total)}` : '';
      const speed = d.speed > 0 ? ` · ${formatBytes(d.speed)}/s` : '';
      const left = d.speed > 0 && d.total ? ` · ${formatDuration((d.total - d.received) / d.speed)} left` : '';
      return `${formatBytes(d.received)}${pct}${speed}${left}`;
    }
    case 'paused':
      return `Paused · ${formatBytes(d.received)}${d.total ? ` of ${formatBytes(d.total)}` : ''}`;
    case 'completed':
      return `${formatBytes(d.total || d.received)} · ${from}${d.exists === false ? ' · Deleted' : ''}`;
    case 'cancelled':
      return `Cancelled · ${from}`;
    default:
      return `Failed · ${from}`;
  }
}

function btn(label, ic, onClick, primary = false) {
  const b = h(`button.btn.small${primary ? '.primary' : ''}`, { html: icon(ic, 14) }, label);
  b.addEventListener('click', onClick);
  return b;
}

function row(d) {
  const cls = d.state === 'interrupted' ? 'failed' : d.exists === false ? 'deleted' : d.state;
  const act = (a) => () => call('downloadAction', d.id, a);
  const name = d.state === 'completed' && d.exists !== false ? h('a', { href: '#', title: d.path }, d.filename) : h('span', { title: d.path || d.filename }, d.filename);
  name.addEventListener('click', (e) => {
    e.preventDefault();
    if (d.state === 'completed') call('downloadAction', d.id, 'open');
  });
  const info = h('div.info', {}, h('div.name', {}, name), h('div.meta', { title: d.url }, meta(d)));
  if (d.state === 'progressing' || d.state === 'paused') {
    info.append(h('div.bar', {}, h('div', { style: { width: `${d.total ? Math.min(100, (d.received / d.total) * 100) : 5}%` } })));
  }
  const acts = h('div.acts');
  if (d.state === 'progressing') acts.append(btn('Pause', 'pause', act('pause')), btn('Cancel', 'x', act('cancel')));
  else if (d.state === 'paused') acts.append(btn('Resume', 'play', act('resume'), true), btn('Cancel', 'x', act('cancel')));
  else if (d.state === 'completed' && d.exists !== false) acts.append(btn('Show in folder', 'folder', act('show')));
  else if (d.state !== 'completed') acts.append(btn('Retry', 'reload', act('retry')));
  const rm = h('button.icon-btn', { title: 'Remove from list', 'aria-label': 'Remove from list', html: icon('x', 16) });
  rm.addEventListener('click', act('remove'));
  acts.append(rm);
  return h(`div.dl.${cls}`, {}, h('div.type', ext(d.filename) ? {} : { html: icon('file', 20) }, ext(d.filename).slice(0, 4)), info, acts);
}

async function render() {
  const list = $('#list');
  const q = $('#q').value.trim().toLowerCase();
  const items = (await call('downloadsList')).filter((d) => !q || `${d.filename} ${d.url}`.toLowerCase().includes(q));
  list.textContent = '';
  if (!items.length) {
    list.append(h('div.empty', {}, h('div.empty-icon', { html: icon('download', 30) }), h('h2', {}, q ? 'No matching downloads' : 'No downloads yet'), h('p', {}, q ? 'Try a different search.' : 'Files you download will appear here.')));
    return;
  }
  let lastDay = '';
  let body;
  for (const d of items) {
    const day = new Date(d.startTime).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      body = h('div.card-body');
      list.append(h('div.card', { style: { marginBottom: '16px' } }, h('div.group-title', {}, dayLabel(d.startTime)), body));
    }
    body.append(row(d));
  }
}

async function main() {
  await initPage();
  $('#title').innerHTML = `${icon('download', 28)}Downloads`;
  $('#search-icon').innerHTML = icon('search', 17);
  $('#clear').innerHTML = `${icon('broom', 16)}Clear all`;
  $('#clear').title = 'Remove finished downloads from this list (files stay on disk)';
  $('#clear').addEventListener('click', async () => {
    await call('downloadsClear');
    render();
  });
  $('#q').addEventListener('input', debounce(render, 120));
  lib.on('downloads', debounce(render, 100));
  await render();
}

main();
