import { h, $ } from '/_shared/dom.js';
import { call, initPage, formDialog, confirmDialog, toast } from '/_shared/page.js';
let items = [];
function button(label, action, primary = false) {
  const b = h(`button.btn${primary ? '.primary' : ''}`, {}, label);
  b.addEventListener('click', async () => { b.disabled = true; try { await action(); } catch (err) { toast(err.message || 'Could not complete action'); } finally { b.disabled = false; } });
  return b;
}
function render() {
  const q = $('#filter').value.trim().toLowerCase();
  const matches = items.filter(x => `${x.name} ${x.tabs.map(t => t.title + ' ' + t.url).join(' ')}`.toLowerCase().includes(q));
  $('#items').replaceChildren(...matches.map(item => h('article.card', {},
    h('h2', {}, item.name), h('span.badge', {}, `${item.tabs.length} tabs`),
    h('ul.workspace-tabs', {}, ...item.tabs.map(t => h('li', { title: t.url }, t.title))),
    h('div.workspace-actions', {},
      button('Open workspace', () => call('workspaceOpen', item.id), true),
      button('Rename', async () => { const r = await formDialog({ title: 'Rename workspace', fields: [{ name: 'name', label: 'Name', value: item.name }], submit: 'Save' }); if (r?.name && await call('workspaceRename', item.id, r.name)) await refresh(); }),
      button('Delete', async () => { if (await confirmDialog({ title: 'Delete workspace?', message: `Remove “${item.name}”? Open tabs and bookmarks will remain.`, confirm: 'Delete' })) { await call('workspaceRemove', item.id); await refresh(); } }),
    ),
  )));
  $('#status').textContent = matches.length ? `${matches.length} saved workspace${matches.length === 1 ? '' : 's'}` : q ? 'No matching workspaces.' : 'Save a group of web pages to start. Saved links are kept on this computer; page contents are not saved offline.';
}
async function refresh() { items = await call('workspaceList'); render(); }
async function main() {
  await initPage();
  $('#filter').addEventListener('input', render);
  $('#save').addEventListener('click', async () => {
    const b = $('#save'); b.disabled = true;
    try {
      const r = await formDialog({ title: 'Save current tabs', fields: [{ name: 'name', label: 'Workspace name', value: 'My workspace' }], submit: 'Save' });
      if (!r) return;
      await call('workspaceSave', r.name); await refresh(); toast('Workspace saved');
    } catch (err) { toast(err.message || 'Could not save workspace'); }
    finally { b.disabled = false; }
  });
  await refresh();
}
main();
