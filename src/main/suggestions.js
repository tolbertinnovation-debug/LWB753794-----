'use strict';

const ctx = require('./context');
const { resolveInput, displayUrl } = require('./url-utils');
const { getEngine, fill, KEYWORDS } = require('./search-engines');
const { evaluate } = require('./calc');

function searchOpts() {
  return { searchEngine: ctx.settings.get('searchEngine'), customSearchUrl: ctx.settings.get('customSearchUrl') };
}

function words(text) {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesAll(hay, ws) {
  const h = hay.toLowerCase();
  return ws.every((w) => h.includes(w));
}

/**
 * Local (instant) suggestions for the address bar.
 * @param {string} text
 * @param {{ isPrivate?: boolean, windowId?: number, currentTabId?: number }} opts
 */
function localSuggestions(text, opts = {}) {
  const input = text.trim();
  const out = { input: text, inline: null, items: [] };
  if (!input) return out;
  const so = searchOpts();
  const resolved = resolveInput(input, so);
  const engine = getEngine(so.searchEngine, so.customSearchUrl);
  const ws = words(input);

  // 1. What the user typed.
  if (resolved) {
    if (resolved.type === 'search') {
      out.items.push({ type: 'search', title: input, subtitle: `Search ${engine.name}`, url: resolved.url });
    } else if (resolved.type === 'keyword') {
      out.items.push({ type: 'keyword', title: resolved.query, subtitle: `Search ${resolved.engine}`, url: resolved.url });
    } else {
      out.items.push({ type: 'url', title: displayUrl(resolved.url) || resolved.url, subtitle: 'Open', url: resolved.url });
    }
  }

  // 2. Calculator.
  const calc = evaluate(input);
  if (calc) out.items.push({ type: 'calc', title: `= ${calc.text}`, subtitle: `${input.replace(/^=\s*/, '')}`, value: calc.text });

  // Keyword hint: typing "yt" suggests "yt <query>".
  const kwHint = KEYWORDS.find((k) => !k.bangOnly && k.keyword === input.toLowerCase());
  if (kwHint) out.items.push({ type: 'hint', title: `${kwHint.keyword} …`, subtitle: `Type a query to search ${kwHint.name}`, fill: `${kwHint.keyword} ` });

  const seen = new Set(out.items.map((i) => i.url).filter(Boolean));

  // 3. Open tabs (switch to tab).
  const windows = require('./windows').all().filter((w) => w.isPrivate === Boolean(opts.isPrivate));
  let tabCount = 0;
  for (const w of windows) {
    for (const t of w.tabs) {
      if (tabCount >= 3) break;
      if (t.id === opts.currentTabId) continue;
      const url = t.state.url;
      if (!url || url.startsWith('lib://newtab')) continue;
      if (!matchesAll(`${t.state.title} ${url}`, ws)) continue;
      out.items.push({ type: 'tab', title: t.state.title || url, subtitle: displayUrl(url), url, favicon: t.state.favicon, tabId: t.id, windowId: w.id });
      seen.add(url);
      tabCount++;
    }
  }

  // 4. Bookmarks.
  for (const b of ctx.bookmarks.search(input, 3)) {
    if (seen.has(b.url) || /^javascript:/i.test(b.url)) continue;
    out.items.push({ type: 'bookmark', title: b.title || b.url, subtitle: displayUrl(b.url), url: b.url });
    seen.add(b.url);
  }

  // 5. History (not shown in private windows' ranking? Chrome shows it; so do we).
  const hist = ctx.history.searchUrls(input, 8);
  let histCount = 0;
  for (const h of hist) {
    if (seen.has(h.url) || histCount >= 6) continue;
    out.items.push({ type: 'history', title: h.title || displayUrl(h.url), subtitle: displayUrl(h.url), url: h.url, favicon: h.favicon, removable: true });
    seen.add(h.url);
    histCount++;
  }

  // Inline autocomplete (only for URL-ish input without spaces).
  if (opts.allowInline !== false && !/\s/.test(input) && resolved && resolved.type !== 'keyword') {
    const inline = ctx.history.inlineMatch(input);
    if (inline && inline.completion.toLowerCase().startsWith(input.toLowerCase())) {
      out.inline = inline.completion;
      const url = inline.url;
      // Promote the completed URL to be the default action.
      if (url) {
        const bare = url.replace(/\/$/, '');
        out.items = out.items.filter((i) => !i.url || i.url.replace(/\/$/, '') !== bare);
        out.items[0] = { type: 'url', title: displayUrl(url), subtitle: 'Open', url, inline: true };
        const existing = hist.find((h) => h.url.replace(/\/$/, '') === bare);
        if (existing) {
          out.items[0].title = existing.title || displayUrl(url);
          out.items[0].subtitle = displayUrl(url);
          out.items[0].favicon = existing.favicon;
        }
        // Keep "search for …" available right after.
        if (resolved.type === 'search' || resolved.type === 'url') {
          const q = resolveInput(`?${input}`, so);
          out.items.splice(1, 0, { type: 'search', title: input, subtitle: `Search ${engine.name}`, url: q.url });
        }
      }
    }
  }
  return out;
}

/**
 * Remote search suggestions from the search engine (cookie-less session).
 * @returns {Promise<Array<{type:'suggest', title:string, url:string}>>}
 */
async function remoteSuggestions(text) {
  const input = text.trim();
  if (!input || input.length > 200 || !ctx.settings.get('searchSuggestions') || ctx.isTest) return [];
  const so = searchOpts();
  const resolved = resolveInput(input, so);
  if (!resolved || resolved.type === 'internal' || (resolved.type === 'url' && /^(file|lib|about):/.test(resolved.url))) return [];
  const engine = getEngine(so.searchEngine, so.customSearchUrl);
  if (!engine.suggest) return [];
  const { getSuggestSession } = require('./sessions');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await getSuggestSession().fetch(fill(engine.suggest, input), {
      signal: controller.signal,
      credentials: 'omit',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    let list = [];
    if (Array.isArray(data) && Array.isArray(data[1])) list = data[1];
    else if (Array.isArray(data)) list = data.map((d) => d && (d.phrase || d.q)).filter(Boolean);
    return list
      .filter((s) => typeof s === 'string' && s.trim() && s.toLowerCase() !== input.toLowerCase())
      .slice(0, 5)
      .map((s) => ({ type: 'suggest', title: s, url: fill(engine.search, s) }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { localSuggestions, remoteSuggestions };
