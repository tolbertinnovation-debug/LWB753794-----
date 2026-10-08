'use strict';

const { getEngine, fill, findKeyword } = require('./search-engines');

const INTERNAL_PAGES = new Set([
  'newtab',
  'settings',
  'history',
  'bookmarks',
  'downloads',
  'about',
  'welcome',
  'reader',
  'shortcuts',
  'tasks',
  'workspaces',
]);

// Aliases so muscle memory from other browsers works: chrome://settings etc.
const FOREIGN_INTERNAL = /^(chrome|edge|brave|vivaldi|opera|about):\/?\/?(settings|history|bookmarks|downloads|newtab|version|about)\b/i;

const KNOWN_SCHEMES = /^(https?|file|lib|about|data|blob|view-source|mailto|tel|ftp|ws|wss|chrome-extension|devtools|magnet|sms|javascript):/i;

// Common TLDs to make bare "foo.bar" detection confident. Any 2+ letter
// alphabetic TLD is accepted when there's a path or port; this list is used
// for bare hostnames so "hello.world" style sentences still search.
const COMMON_TLDS = new Set(
  (
    'com net org edu gov mil int io ai app dev co me tv us uk ca de fr jp cn in ru br au it es nl se no fi dk pl ch at be cz ' +
    'gr pt ie nz za mx ar cl kr tw hk sg my id ph vn th tr il ae sa eg ng ke info biz xyz online site tech store blog news ' +
    'cloud page link live pro shop top club art design games wiki fm gg ly so to sh cc ws la ms is im li lu eu asia ' +
    'mobi name travel email space website world today life academy agency digital media network solutions studio systems ' +
    'team tools works zone social video music film photo pics cafe bar pub fun love one global local host localhost test ' +
    'onion lan internal home arpa'
  ).split(' '),
);

function isIPv4(host) {
  const parts = host.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isLocalHost(host) {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.lan') ||
    h.endsWith('.internal') ||
    h.endsWith('.home.arpa') ||
    h === '[::1]' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h === '0.0.0.0'
  );
}

/**
 * Decide whether `text` (no scheme) is meant to be a host/URL.
 * Returns the URL to load (with scheme) or null.
 */
function guessUrl(text) {
  if (/\s/.test(text)) return null;
  // Split host[:port] from the rest.
  const m = text.match(/^([^/?#]+)([/?#].*)?$/);
  if (!m) return null;
  let hostPort = m[1];
  const rest = m[2] || '';
  if (hostPort.includes('@')) hostPort = hostPort.split('@').pop();

  let host = hostPort;
  let port = '';
  const v6 = hostPort.match(/^(\[[0-9a-f:.]+\])(?::(\d+))?$/i);
  if (v6) {
    host = v6[1];
    port = v6[2] || '';
  } else {
    const pm = hostPort.match(/^(.*?)(?::(\d{1,5}))?$/);
    host = pm[1];
    port = pm[2] || '';
    if (hostPort.includes(':') && !pm[2]) return null; // "foo:bar"
  }
  if (!host) return null;

  const lower = host.toLowerCase();
  const local = isLocalHost(lower) || lower === 'localhost';
  const scheme = local || isIPv4(lower) ? 'http' : 'https';

  if (lower === 'localhost' || v6 || isIPv4(lower)) return `${scheme}://${text}`;

  if (!/^[a-z0-9-_.¡-￿]+$/i.test(host)) return null;
  const labels = lower.split('.');
  if (labels.length < 2 || labels.some((l) => !l)) {
    // Single word with a port or path, e.g. "intranet:8080" or "router/admin"
    if (port) return `http://${text}`;
    return null;
  }
  const tld = labels[labels.length - 1];
  if (/^\d+$/.test(tld)) return null; // "3.14"
  if (COMMON_TLDS.has(tld) || /^xn--/.test(tld)) return `${scheme}://${text}`;
  // Unknown-but-plausible TLD: accept if a path/port was given, or it's 2-6 letters.
  if ((port || rest) && /^[a-z]{2,63}$/.test(tld)) return `${scheme}://${text}`;
  return null;
}

/**
 * Turn address-bar input into a URL.
 *
 * @param {string} input raw text typed by the user
 * @param {{ searchEngine?: string, customSearchUrl?: string }} [opts]
 * @returns {{ url: string, type: 'url' | 'search' | 'keyword' | 'internal', engine?: string, query?: string } | null}
 */
function resolveInput(input, opts = {}) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text) return null;

  // Internal pages: "lib://settings", "lib:settings", "chrome://settings"
  const libMatch = text.match(/^lib:\/?\/?([a-z-]+)(.*)$/i);
  if (libMatch) {
    const page = libMatch[1].toLowerCase();
    if (INTERNAL_PAGES.has(page)) return { url: `lib://${page}${libMatch[2] || ''}`, type: 'internal' };
  }
  const foreign = text.match(FOREIGN_INTERNAL);
  if (foreign) {
    let page = foreign[2].toLowerCase();
    if (page === 'version') page = 'about';
    return { url: `lib://${page}`, type: 'internal' };
  }
  if (/^about:blank$/i.test(text)) return { url: 'about:blank', type: 'url' };

  // Keyword shortcuts: "yt lofi beats", "!w Ada Lovelace"
  const kw = text.match(/^(!?[a-z]{1,8})\s+(.+)$/i);
  if (kw) {
    const k = findKeyword(kw[1]);
    if (k && (kw[1].startsWith('!') || !guessUrl(text))) {
      return { url: fill(k.url, kw[2]), type: 'keyword', engine: k.name, query: kw[2] };
    }
  }
  // Trailing bang: "cats !yt"
  const trailing = text.match(/^(.+)\s+!([a-z]{1,8})$/i);
  if (trailing) {
    const k = findKeyword(`!${trailing[2]}`);
    if (k) return { url: fill(k.url, trailing[1]), type: 'keyword', engine: k.name, query: trailing[1] };
  }

  // Explicit scheme.
  if (KNOWN_SCHEMES.test(text)) {
    if (/^javascript:/i.test(text)) return null; // never run bookmarklets from the omnibox
    if (/^(https?|ftp|wss?):/i.test(text) && !/^[a-z]+:\/\//i.test(text)) {
      // "http:example.com" → "http://example.com"
      return { url: text.replace(/^([a-z]+):\/*/i, '$1://'), type: 'url' };
    }
    return { url: text, type: 'url' };
  }
  // Windows / Unix absolute file paths.
  if (/^[a-zA-Z]:[\\/]/.test(text) || text.startsWith('/') || text.startsWith('~/')) {
    if (!/\s/.test(text) || /^[a-zA-Z]:[\\/]/.test(text)) {
      const p = text.replace(/\\/g, '/');
      return { url: `file://${p.startsWith('/') ? '' : '/'}${encodeURI(p)}`, type: 'url' };
    }
  }

  // Force search with a leading "?"
  if (text.startsWith('?')) {
    const q = text.slice(1).trim();
    const engine = getEngine(opts.searchEngine, opts.customSearchUrl);
    return { url: fill(engine.search, q), type: 'search', engine: engine.name, query: q };
  }

  const guessed = guessUrl(text);
  if (guessed) return { url: guessed, type: 'url' };

  const engine = getEngine(opts.searchEngine, opts.customSearchUrl);
  return { url: fill(engine.search, text), type: 'search', engine: engine.name, query: text };
}

/**
 * If `url` is a search results page of the given engine, return the query.
 */
function extractSearchQuery(url, opts = {}) {
  try {
    const engine = getEngine(opts.searchEngine, opts.customSearchUrl);
    const template = new URL(engine.search.replace('%s', '__Q__'));
    const u = new URL(url);
    if (u.hostname !== template.hostname || u.pathname !== template.pathname) return null;
    for (const [key, value] of template.searchParams) {
      if (value === '__Q__') return u.searchParams.get(key);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Human-friendly URL for display (unescapes, strips trailing slash on bare hosts). */
function displayUrl(url) {
  if (!url) return '';
  if (url.startsWith('lib://newtab')) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      let out = `${u.protocol}//${u.host}${u.pathname}${u.search}${u.hash}`;
      try {
        out = decodeURI(out);
      } catch {
        /* keep encoded */
      }
      if (u.pathname === '/' && !u.search && !u.hash) out = out.replace(/\/$/, '');
      return out;
    }
  } catch {
    /* not a URL */
  }
  return url;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function originOf(url) {
  try {
    const u = new URL(url);
    if (u.origin && u.origin !== 'null') return u.origin;
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/** Registrable-ish site key: strips a leading "www." */
function siteOf(url) {
  return hostOf(url).replace(/^www\./, '');
}

module.exports = {
  resolveInput,
  guessUrl,
  displayUrl,
  hostOf,
  originOf,
  siteOf,
  isLocalHost,
  extractSearchQuery,
  INTERNAL_PAGES,
};
