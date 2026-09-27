import { h, formatBytes, formatDuration } from './util.js';
import { icon } from './icons.js';
import { state, bus, invoke, send } from './state.js';
import { openPopup } from './popups.js';
import { toast } from './toast.js';

// ------------------------------------------------------------ downloads

function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name || '');
  return m ? m[1] : '';
}

function statusText(d) {
  switch (d.state) {
    case 'progressing': {
      const pct = d.total ? ` of ${formatBytes(d.total)}` : '';
      const left = d.speed > 0 && d.total ? ` — ${formatDuration((d.total - d.received) / d.speed)} left` : '';
      return `${formatBytes(d.received)}${pct}${left}`;
    }
    case 'paused':
      return `Paused — ${formatBytes(d.received)}${d.total ? ` of ${formatBytes(d.total)}` : ''}`;
    case 'completed':
      return d.exists === false ? 'Deleted' : formatBytes(d.total || d.received);
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Failed';
  }
}

export function downloadRow(d, { compact = false } = {}) {
  const cls = d.state === 'interrupted' ? 'failed' : d.state;
  const row = h(`div.dl-item.${cls}`);
  const ext = extOf(d.filename);
  row.append(h('div.dl-icon', ext ? {} : { html: icon('file', 18) }, ext.slice(0, 4)));
  const main = h('div.dl-main', {}, h('div.dl-name', { title: d.filename }, d.filename), h('div.dl-status', {}, statusText(d)));
  if (d.state === 'progressing' || d.state === 'paused') {
    const pct = d.total ? Math.min(100, (d.received / d.total) * 100) : 0;
    main.append(h(`div.dl-bar${d.total ? '' : '.indeterminate'}`, {}, h('div', { style: { width: `${pct}%` } })));
  }
  row.append(main);
  const act = (name, title, action) => {
    const b = h('button.icon-btn.small', { title, 'aria-label': title, html: icon(name, 16) });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      send('downloadAction', d.id, action);
    });
    return b;
  };
  if (d.state === 'progressing') row.append(act('pause', 'Pause', 'pause'), act('x', 'Cancel', 'cancel'));
  else if (d.state === 'paused') row.append(act('play', 'Resume', 'resume'), act('x', 'Cancel', 'cancel'));
  else if (d.state === 'completed' && d.exists !== false) row.append(act('folder', 'Show in folder', 'show'));
  else if (d.state === 'interrupted' || d.state === 'cancelled') row.append(act('reload', 'Retry', 'retry'));
  if (d.state === 'completed' && d.exists !== false) {
    row.addEventListener('click', () => send('downloadAction', d.id, 'open'));
    row.title = 'Open file';
  }
  if (compact) row.classList.add('compact');
  return row;
}

export function openDownloadsPanel(anchor) {
  const body = h('div.panel-body');
  const render = (summary) => {
    body.textContent = '';
    const list = summary?.recent || [];
    if (!list.length) body.append(h('div.empty-note', {}, 'No downloads yet'));
    for (const d of list) body.append(downloadRow(d));
  };
  const all = h('button.btn', {}, 'Show all downloads');
  all.addEventListener('click', () => {
    popup.close();
    send('command', 'downloads');
  });
  const panel = h('div.panel', {}, h('div.panel-head', {}, h('h3', {}, 'Recent downloads')), body, h('div.panel-foot', {}, all));
  render(state.downloads);
  const off = bus.on('downloads', render);
  const popup = openPopup(panel, { anchor, placement: 'bottom-end', onClose: off });
  invoke('downloads').then(render);
  return popup;
}

// ------------------------------------------------------------ site info

const SECURITY_TEXT = {
  secure: ['Connection is secure', 'Your information (for example, passwords or card numbers) is private when it is sent to this site.'],
  insecure: ['Connection is not secure', 'Don’t enter sensitive information on this site (for example, passwords or credit cards).'],
  dangerous: ['Certificate is not trusted', 'You chose to proceed even though this site’s security certificate is not valid.'],
  internal: ['LIB Browser page', 'This is a secure page built into LIB Browser.'],
  file: ['Local file', 'This page is stored on your computer or network.'],
  none: ['Site information', ''],
};

export async function openSitePanel(anchor) {
  const info = await invoke('siteInfo');
  if (!info) return null;
  const [title, desc] = SECURITY_TEXT[info.security] || SECURITY_TEXT.none;
  const panel = h('div.panel.site-panel');
  panel.append(
    h(
      'div.panel-head',
      {},
      h(`div.big-icon.${info.security}`, { html: icon(info.security === 'secure' ? 'lock' : info.security === 'internal' ? 'shieldCheck' : info.security === 'file' ? 'file' : 'alert', 20) }),
      h('div', { style: { minWidth: 0, flex: 1 } }, h('h3', {}, info.host || info.url), h('div.sub', {}, title)),
    ),
  );
  const body = h('div.panel-body');
  if (desc) body.append(h('div.row', {}, h('span.muted', {}, desc)));

  if (info.isHttp) {
    const blocking = info.adblockEnabled && !info.allowlisted;
    const sw = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Block ads and trackers on this site' });
    sw.checked = blocking;
    sw.disabled = !info.adblockEnabled;
    sw.addEventListener('change', () => {
      send('toggleSiteAdblock');
      popup.close();
    });
    body.append(
      h(
        'div.panel-section',
        {},
        h('h4', {}, 'Tracker & ad blocking'),
        h(
          'div.row',
          {},
          h('div.big-icon.shield', { html: icon(blocking ? 'shieldCheck' : 'shieldOff', 18) }),
          h('div.grow', {}, h('div', { style: { fontWeight: 600 } }, blocking ? `${info.blocked} blocked on this page` : info.adblockEnabled ? 'Allowed on this site' : 'Blocking is off'), h('div.muted', {}, blocking ? 'Ads, trackers and fingerprinters' : 'Turn on to block ads and trackers here')),
          h('label.switch', {}, sw),
        ),
      ),
    );

    const permSection = h('div.panel-section', {}, h('h4', {}, 'Permissions'));
    if (!info.permissions.length) permSection.append(h('div.row', {}, h('span.muted', {}, 'This site hasn’t asked for any permissions.')));
    for (const p of info.permissions) {
      const sel = h('select.select', { 'aria-label': p.label }, h('option', { value: 'allow' }, 'Allow'), h('option', { value: 'block' }, 'Block'), h('option', { value: 'ask' }, 'Ask'));
      sel.value = p.value;
      sel.addEventListener('change', () => send('setSitePermission', p.key, sel.value));
      permSection.append(h('div.row.perm-row', {}, h('span.grow', {}, p.label), sel));
    }
    body.append(permSection);

    const actions = h('div.panel-section', {}, h('h4', {}, 'Site data'));
    const clear = h('button.btn', {}, 'Clear cookies & site data');
    clear.addEventListener('click', () => {
      send('clearSiteData');
      popup.close();
      toast(`Cleared site data for ${info.host}`);
    });
    const zoomReset = info.zoom && Math.abs(info.zoom - 1) > 0.001 ? h('button.btn.ghost', {}, `Reset zoom (${Math.round(info.zoom * 100)}%)`) : null;
    zoomReset?.addEventListener('click', () => {
      send('zoom', 'reset');
      popup.close();
    });
    actions.append(h('div.row', {}, clear, zoomReset));
    body.append(actions);
  }
  const settingsBtn = h('button.btn.ghost', {}, 'Privacy settings');
  settingsBtn.addEventListener('click', () => {
    popup.close();
    send('openUrl', 'lib://settings/#privacy', 'tab');
  });
  const copyBtn = h('button.btn', {}, 'Copy link');
  copyBtn.addEventListener('click', () => {
    send('copyText', info.url);
    popup.close();
    toast('Link copied');
  });
  panel.append(body, h('div.panel-foot', {}, settingsBtn, copyBtn));
  const popup = openPopup(panel, { anchor, placement: 'bottom-start' });
  return popup;
}

// ------------------------------------------------------------ bookmarks

export async function openBookmarkEditor(anchor, { id } = {}) {
  let info;
  if (id) {
    info = await invoke('bookmarkGet', id);
    if (!info) return null;
  } else {
    info = await invoke('bookmarkInfo');
    if (!info || !info.bookmarkable) {
      toast('This page can’t be bookmarked');
      return null;
    }
    if (!info.bookmarked) {
      // Clicking the star bookmarks immediately (like Chrome); the editor lets
      // you rename/move it.
      info.id = await invoke('bookmarkQuickAdd');
      info.bookmarked = true;
    }
  }
  const isFolder = info.type === 'folder';
  const title = h('input', { type: 'text', value: info.title || '', spellcheck: 'false' });
  const url = h('input', { type: 'text', value: info.url || '', spellcheck: 'false' });
  const folder = h('select');
  for (const f of info.folders || []) {
    if (isFolder && f.id === info.id) continue;
    folder.append(h('option', { value: f.id }, `${' '.repeat(f.depth)}${f.title}`));
  }
  folder.value = info.parentId || 'bar';
  const done = h('button.btn.primary', {}, 'Done');
  const remove = h('button.btn.danger', {}, 'Remove');
  const form = h(
    'form.dialog',
    {},
    h('h3', {}, id ? (isFolder ? 'Edit folder' : 'Edit bookmark') : 'Bookmark added'),
    h('div.field', {}, h('label', {}, 'Name'), title),
    !isFolder && id ? h('div.field', {}, h('label', {}, 'URL'), url) : null,
    h('div.field', {}, h('label', {}, 'Folder'), folder),
    h('div.actions', {}, remove, h('span', { style: { flex: 1 } }), done),
  );
  const save = () => {
    const changes = { title: title.value.trim() || info.title, parentId: folder.value };
    if (id && !isFolder) changes.url = url.value.trim() || info.url;
    send('bookmarkUpdate', info.id, changes);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
    popup.close('done');
  });
  remove.addEventListener('click', (e) => {
    e.preventDefault();
    send('bookmarkRemove', info.id);
    popup.close('removed');
  });
  const popup = openPopup(form, {
    anchor,
    placement: anchor ? 'bottom-end' : 'center',
    focus: title,
    onClose: (reason) => {
      if (reason !== 'removed' && reason !== 'done' && reason !== 'escape') save();
    },
  });
  setTimeout(() => title.select(), 10);
  return popup;
}

// ------------------------------------------------------------ HTTP auth

export function openAuthDialog(req) {
  const user = h('input', { type: 'text', autocomplete: 'username', spellcheck: 'false' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password' });
  const where = `${req.isProxy ? 'The proxy ' : ''}${req.host}${req.port && ![80, 443].includes(req.port) ? `:${req.port}` : ''}`;
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const form = h(
    'form.dialog',
    {},
    h('h3', {}, 'Sign in'),
    h('p', {}, `${where} requires a username and password.${req.realm ? ` It says: “${req.realm}”` : ''}`),
    h('div.field', {}, h('label', {}, 'Username'), user),
    h('div.field', {}, h('label', {}, 'Password'), pass),
    h('div.actions', {}, cancel, h('button.btn.primary', { type: 'submit' }, 'Sign in')),
  );
  let answered = false;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    answered = true;
    send('authRespond', req.id, { username: user.value, password: pass.value });
    popup.close();
  });
  cancel.addEventListener('click', () => popup.close());
  const popup = openPopup(form, {
    modal: true,
    placement: 'center',
    focus: user,
    className: 'sticky',
    onClose: () => {
      if (!answered) send('authRespond', req.id, null);
    },
  });
  return popup;
}

export function initPanels() {
  const authPopups = new Map();
  bus.on('open-site-panel', () => openSitePanel(document.querySelector('#site-chip')));
  bus.on('bookmark-edit', (msg) => {
    const star = document.querySelector('#btn-star');
    openBookmarkEditor(msg?.id ? null : star && !star.hidden ? star : null, msg || {});
  });
  bus.on('auth-request', (req) => authPopups.set(req.id, openAuthDialog(req)));
  bus.on('auth-cancel', ({ id }) => {
    authPopups.get(id)?.close();
    authPopups.delete(id);
  });
}
