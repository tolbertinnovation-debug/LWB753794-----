import { h, $ } from '/_shared/dom.js';
import { icon } from '/_shared/icons.js';
import { call, initPage, toast, applyAccent } from '/_shared/page.js';

const LOGO = '<svg class="logo" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset=".55" stop-color="#6366f1"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><path d="M24 17v30h19" fill="none" stroke="#fff" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="43.5" cy="21.5" r="5.2" fill="#fff"/></svg>';

let S;
let meta;
let step = 0;

async function set(key, value) {
  S[key] = value;
  await call('setSetting', key, value);
}

function choice({ title, sub, iconName, on, onClick, preview }) {
  const b = h(`button.choice${on ? '.on' : ''}`, {}, preview || (iconName ? h('span.ic', { html: icon(iconName, 22) }) : null), h('b', {}, title), sub ? h('small', {}, sub) : null);
  b.addEventListener('click', onClick);
  return b;
}

function switchRow(title, desc, key) {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = Boolean(S[key]);
  input.addEventListener('change', () => set(key, input.checked));
  return h('div.row-line', {}, h('div.grow', {}, h('div', { style: { fontWeight: 600 } }, title), h('div.desc', {}, desc)), h('label.switch', {}, input));
}

const STEPS = [
  () =>
    h(
      'div.step',
      {},
      h('div', { html: LOGO }),
      h('h1', {}, 'Welcome to LIB Browser'),
      h('p.lead', {}, 'A fast, private and beautiful way to explore the web. Ads and trackers are blocked from the start — let’s make it yours in a few quick steps.'),
    ),
  () => {
    const wrap = h('div.step', {}, h('h1', {}, 'Choose your look'), h('p.lead', {}, 'You can change this anytime in Settings.'));
    const themes = h('div.choices');
    const render = () => {
      themes.textContent = '';
      for (const [value, title, bg] of [
        ['system', 'Match system', 'linear-gradient(135deg,#f4f5f9 50%,#1d1e23 50%)'],
        ['light', 'Light', '#f4f5f9'],
        ['dark', 'Dark', '#1d1e23'],
      ]) {
        themes.append(
          choice({
            title,
            on: S.theme === value,
            preview: h('div.preview', { style: { background: bg } }),
            onClick: async () => {
              await set('theme', value);
              render();
            },
          }),
        );
      }
    };
    render();
    const swatches = h('div.swatches', { style: { margin: '6px 0 18px' } });
    const renderSw = () => {
      swatches.textContent = '';
      for (const c of meta.accents) {
        const s = h(`button.swatch${S.accentColor === c ? '.on' : ''}`, { style: { background: c, color: c }, 'aria-label': c });
        s.addEventListener('click', async () => {
          await set('accentColor', c);
          applyAccent(c);
          renderSw();
        });
        swatches.append(s);
      }
    };
    renderSw();
    wrap.append(themes, h('div', { style: { fontWeight: 600, marginTop: '8px' } }, 'Accent color'), swatches, switchRow('Vertical tabs', 'Show tabs in a sidebar instead of across the top.', 'verticalTabs'));
    return wrap;
  },
  () => {
    const wrap = h('div.step', {}, h('h1', {}, 'Pick a search engine'), h('p.lead', {}, 'Used when you type in the address bar.'));
    const grid = h('div.choices');
    const render = () => {
      grid.textContent = '';
      const subs = { google: 'Most popular', duckduckgo: 'Private search', bing: 'By Microsoft', brave: 'Independent index', startpage: 'Google results, privately', ecosia: 'Plants trees', yahoo: 'Classic' };
      for (const e of meta.searchEngines) {
        grid.append(
          choice({
            title: e.name,
            sub: subs[e.id] || '',
            iconName: 'search',
            on: S.searchEngine === e.id,
            onClick: async () => {
              await set('searchEngine', e.id);
              render();
            },
          }),
        );
      }
    };
    render();
    wrap.append(grid);
    return wrap;
  },
  () =>
    h(
      'div.step',
      {},
      h('h1', {}, 'Your privacy, protected'),
      h('p.lead', {}, 'These protections are on by default. Adjust them to taste.'),
      switchRow('Block ads & trackers', 'Faster pages, fewer distractions, less tracking.', 'adblockEnabled'),
      switchRow('HTTPS-Only mode', 'Always use secure connections when possible.', 'httpsOnly'),
      switchRow('Global Privacy Control', 'Tell sites not to sell or share your data.', 'globalPrivacyControl'),
      switchRow('Tab sleeping', 'Save memory by pausing tabs you haven’t used for a while.', 'tabSleepEnabled'),
    ),
  () => {
    const imp = h('button.btn', { html: icon('download', 16) }, 'Import bookmarks…');
    imp.addEventListener('click', async () => {
      const n = await call('bookmarksImport').catch(() => -2);
      if (n >= 0) toast(`Imported ${n} bookmark${n === 1 ? '' : 's'}`);
    });
    const def = h('button.btn.primary', { html: icon('check', 16) }, 'Make default');
    call('defaultBrowserStatus').then((s) => {
      if (s.isDefault) {
        def.disabled = true;
        def.textContent = 'Already default';
      }
    });
    def.addEventListener('click', async () => {
      await call('makeDefaultBrowser');
      def.disabled = true;
      def.textContent = 'Done';
    });
    return h(
      'div.step',
      {},
      h('h1', {}, 'Bring your stuff'),
      h('p.lead', {}, 'Export bookmarks from Chrome, Edge, Firefox or Safari as an HTML file, then import it here.'),
      h('div.row-line', {}, h('div.grow', {}, h('div', { style: { fontWeight: 600 } }, 'Import bookmarks'), h('div.desc', {}, 'From an HTML bookmarks file.')), imp),
      h('div.row-line', {}, h('div.grow', {}, h('div', { style: { fontWeight: 600 } }, 'Make LIB your default browser'), h('div.desc', {}, 'Links from other apps will open here.')), def),
    );
  },
  () => {
    const name = h('input.input', { type: 'text', placeholder: 'What should we call you? (optional)', value: S.ntpName || '', maxlength: '40', style: { width: '100%', marginBottom: '8px' } });
    name.addEventListener('change', () => set('ntpName', name.value.trim()));
    return h(
      'div.step',
      {},
      h('div', { html: LOGO }),
      h('h1', {}, 'You’re all set!'),
      h('p.lead', {}, 'Tip: press Ctrl+Shift+A to search tabs and commands, and right-click a tab to open split view.'),
      name,
    );
  },
];

function render() {
  const w = $('#wizard');
  w.textContent = '';
  w.append(STEPS[step]());
  const dots = h('div.dots', {}, ...STEPS.map((_, i) => h(`span${i === step ? '.on' : ''}`)));
  const back = h('button.btn.ghost.big-btn', {}, 'Back');
  back.hidden = step === 0;
  back.addEventListener('click', () => {
    step--;
    render();
  });
  const last = step === STEPS.length - 1;
  const next = h('button.btn.primary.big-btn', {}, step === 0 ? 'Get started' : last ? 'Start browsing' : 'Continue');
  next.addEventListener('click', async () => {
    if (last) {
      await call('finishOnboarding');
      location.replace('lib://newtab/');
      return;
    }
    step++;
    render();
  });
  const skip = h('button.btn.ghost.big-btn', {}, 'Skip');
  skip.hidden = last || step === 0;
  skip.addEventListener('click', async () => {
    await call('finishOnboarding');
    location.replace('lib://newtab/');
  });
  w.append(h('div.nav', {}, dots, back, skip, next));
  next.focus();
}

async function main() {
  const data = await initPage();
  S = data.settings;
  meta = data;
  render();
}

main();
