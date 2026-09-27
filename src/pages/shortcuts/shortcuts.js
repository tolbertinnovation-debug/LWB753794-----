import { h, $ } from '/_shared/dom.js';
import { icon } from '/_shared/icons.js';
import { call, initPage } from '/_shared/page.js';

let all = [];

function render() {
  const q = $('#q').value.trim().toLowerCase();
  const grid = $('#grid');
  grid.textContent = '';
  const sections = new Map();
  for (const s of all) {
    if (q && !`${s.label} ${s.shortcuts.join(' ')}`.toLowerCase().includes(q)) continue;
    if (!sections.has(s.section)) sections.set(s.section, []);
    sections.get(s.section).push(s);
  }
  for (const [name, items] of sections) {
    const body = h('div.card-body');
    for (const s of items) {
      body.append(h('div.sc-row', {}, h('span.label', {}, s.label), h('span.keys', {}, ...s.shortcuts.map((k) => h('span.kbd', {}, k)))));
    }
    grid.append(h('div.card', {}, h('div.card-head', {}, h('h2', {}, name)), body));
  }
  if (!sections.size) grid.append(h('div.empty', {}, h('h2', {}, 'No matching shortcuts')));
}

async function main() {
  await initPage();
  $('#title').innerHTML = `${icon('keyboard', 28)}Keyboard shortcuts`;
  $('#search-icon').innerHTML = icon('search', 17);
  all = await call('shortcuts');
  // Extra address-bar tips that aren't commands.
  all.push(
    { label: 'Open result in a new tab', section: 'Address bar', shortcuts: ['Alt+Enter'] },
    { label: 'Add www. and .com', section: 'Address bar', shortcuts: ['Ctrl+Enter'] },
    { label: 'Remove history suggestion', section: 'Address bar', shortcuts: ['Shift+Delete'] },
    { label: 'Search a site: “!w Einstein”, “yt lofi”, “gh electron”', section: 'Address bar', shortcuts: ['!keyword'] },
  );
  $('#q').addEventListener('input', render);
  render();
}

main();
