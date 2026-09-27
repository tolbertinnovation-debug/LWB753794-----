import { h, $ } from '/_shared/dom.js';
import { icon } from '/_shared/icons.js';
import { call, initPage } from '/_shared/page.js';

// Extracted articles come from arbitrary web pages, so their HTML is rebuilt
// through a strict allowlist before display (and this page's CSP forbids
// inline scripts on top of that).
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'picture',
  'pre', 'q', 's', 'samp', 'section', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'video', 'audio', 'article', 'header', 'footer', 'main', 'aside',
]);
const ALLOWED_ATTRS = new Set(['href', 'src', 'srcset', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'datetime', 'cite', 'controls', 'poster', 'type', 'media', 'sizes', 'lang', 'dir']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'noscript', 'template', 'svg', 'math', 'link', 'meta', 'base']);

function safeUrl(value, base, { image = false } = {}) {
  try {
    const u = new URL(value, base);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    if (image && u.protocol === 'data:' && /^data:image\/(png|jpe?g|gif|webp|avif)/i.test(value)) return value;
  } catch {
    /* invalid */
  }
  return null;
}

function sanitize(html, base) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createDocumentFragment();
  const walk = (node, parent) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        parent.append(child.textContent);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toLowerCase();
      if (DROP_WITH_CONTENT.has(tag)) continue;
      if (!ALLOWED_TAGS.has(tag)) {
        walk(child, parent); // unwrap
        continue;
      }
      const el = document.createElement(tag);
      for (const attr of child.attributes) {
        const name = attr.name.toLowerCase();
        if (!ALLOWED_ATTRS.has(name)) continue;
        if (name === 'href') {
          const u = safeUrl(attr.value, base);
          if (u) el.setAttribute('href', u);
        } else if (name === 'src' || name === 'poster') {
          const u = safeUrl(attr.value, base, { image: true });
          if (u) el.setAttribute(name, u);
        } else if (name === 'srcset') {
          const parts = attr.value
            .split(',')
            .map((p) => p.trim().split(/\s+/))
            .map(([u, d]) => [safeUrl(u, base, { image: true }), d])
            .filter(([u]) => u)
            .map(([u, d]) => (d ? `${u} ${d}` : u));
          if (parts.length) el.setAttribute('srcset', parts.join(', '));
        } else {
          el.setAttribute(name, attr.value);
        }
      }
      if (tag === 'img') {
        el.setAttribute('loading', 'lazy');
        el.setAttribute('referrerpolicy', 'no-referrer');
      }
      if (tag === 'video' || tag === 'audio') el.setAttribute('controls', '');
      walk(child, el);
      parent.append(el);
    }
  };
  walk(doc.body, out);
  return out;
}

const PREFS_KEY = 'lib-reader-prefs';
let prefs = { size: 20, font: 'serif', theme: 'auto', width: 700 };
try {
  prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
} catch {
  /* ignore */
}

function applyPrefs() {
  const b = document.body;
  b.style.setProperty('--r-size', `${prefs.size}px`);
  b.style.setProperty('--r-width', `${prefs.width}px`);
  b.classList.toggle('f-sans', prefs.font === 'sans');
  for (const t of ['light', 'sepia', 'dark']) b.classList.toggle(`t-${t}`, prefs.theme === t);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  renderControls();
}

function renderControls() {
  const c = $('#controls');
  c.textContent = '';
  const btn = (label, title, on, onClick, html) => {
    const b = h(`button${on ? '.on' : ''}`, { title, 'aria-label': title, html: html || '' }, html ? '' : label);
    b.addEventListener('click', onClick);
    return b;
  };
  c.append(
    btn('A−', 'Smaller text', false, () => {
      prefs.size = Math.max(14, prefs.size - 2);
      applyPrefs();
    }),
    btn('A+', 'Larger text', false, () => {
      prefs.size = Math.min(34, prefs.size + 2);
      applyPrefs();
    }),
    h('span.sep'),
    btn('Aa', 'Serif font', prefs.font === 'serif', () => {
      prefs.font = 'serif';
      applyPrefs();
    }),
    btn('Aa', 'Sans-serif font', prefs.font === 'sans', () => {
      prefs.font = 'sans';
      applyPrefs();
    }),
    h('span.sep'),
    btn('', 'Narrower', false, () => {
      prefs.width = Math.max(520, prefs.width - 80);
      applyPrefs();
    }, icon('minus', 16)),
    btn('', 'Wider', false, () => {
      prefs.width = Math.min(1100, prefs.width + 80);
      applyPrefs();
    }, icon('plus', 16)),
    h('span.sep'),
  );
  for (const [t, color, title] of [
    ['auto', 'linear-gradient(135deg,#fff 50%,#16171b 50%)', 'Match browser theme'],
    ['light', '#ffffff', 'Light'],
    ['sepia', '#f6efe0', 'Sepia'],
    ['dark', '#16171b', 'Dark'],
  ]) {
    const b = btn('', title, prefs.theme === t, () => {
      prefs.theme = t;
      applyPrefs();
    });
    b.append(h('span.dot', { style: { background: color } }));
    c.append(b);
  }
  c.append(h('span.sep'));
  const exit = btn('', 'Exit reader mode', false, () => history.back(), icon('x', 16));
  c.append(exit);
}

async function main() {
  await initPage();
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const original = params.get('url') || '';
  const article = id ? await call('readerArticle', id) : null;
  applyPrefs();
  const progress = h('div.progress');
  document.body.append(progress);
  window.addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.width = `${max > 0 ? (scrollY / max) * 100 : 0}%`;
  });
  if (!article) {
    $('#headline').textContent = 'This article is no longer available';
    $('#byline').textContent = 'Reader articles are kept only while the browser is open.';
    if (safeUrl(original)) {
      const a = h('a', { href: safeUrl(original) }, 'Open the original page');
      $('#content').append(h('p', {}, a));
    }
    return;
  }
  document.title = article.title;
  if (article.lang) document.documentElement.lang = article.lang;
  if (article.dir) $('#article').dir = article.dir;
  $('#site').textContent = article.siteName || '';
  $('#headline').textContent = article.title;
  const words = (article.length || 0) / 5.5;
  const minutes = Math.max(1, Math.round(words / 230));
  $('#byline').textContent = [article.byline, `${minutes} min read`].filter(Boolean).join(' · ');
  $('#content').append(sanitize(article.content, article.url));
  const src = safeUrl(article.url);
  if (src) {
    const a = h('a', { href: src }, src);
    $('#source').append('Original article: ', a);
  }
  // Links open normally (navigating away from the reader view).
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    call('openUrl', a.href, e.ctrlKey || e.metaKey ? 'background' : 'current');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') history.back();
  });
}

main();
