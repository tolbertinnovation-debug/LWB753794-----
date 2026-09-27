'use strict';

/**
 * Built-in search engines. `%s` is replaced by the URI-encoded query.
 * `suggest` endpoints return OpenSearch-style JSON: [query, [suggestions...]].
 */
const SEARCH_ENGINES = [
  {
    id: 'google',
    name: 'Google',
    search: 'https://www.google.com/search?q=%s',
    suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s',
    home: 'https://www.google.com',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    search: 'https://duckduckgo.com/?q=%s',
    suggest: 'https://duckduckgo.com/ac/?q=%s&type=list',
    home: 'https://duckduckgo.com',
  },
  {
    id: 'bing',
    name: 'Bing',
    search: 'https://www.bing.com/search?q=%s',
    suggest: 'https://api.bing.com/osjson.aspx?query=%s',
    home: 'https://www.bing.com',
  },
  {
    id: 'brave',
    name: 'Brave Search',
    search: 'https://search.brave.com/search?q=%s',
    suggest: 'https://search.brave.com/api/suggest?q=%s',
    home: 'https://search.brave.com',
  },
  {
    id: 'startpage',
    name: 'Startpage',
    search: 'https://www.startpage.com/sp/search?query=%s',
    suggest: null,
    home: 'https://www.startpage.com',
  },
  {
    id: 'ecosia',
    name: 'Ecosia',
    search: 'https://www.ecosia.org/search?q=%s',
    suggest: 'https://ac.ecosia.org/autocomplete?q=%s&type=list',
    home: 'https://www.ecosia.org',
  },
  {
    id: 'yahoo',
    name: 'Yahoo',
    search: 'https://search.yahoo.com/search?p=%s',
    suggest: null,
    home: 'https://search.yahoo.com',
  },
];

/**
 * Keyword shortcuts: type "yt cats" or "!yt cats" in the address bar.
 * `bangOnly` keywords are short/common words and only trigger as "!w query".
 */
const KEYWORDS = [
  { keyword: 'g', name: 'Google', url: 'https://www.google.com/search?q=%s', bangOnly: true },
  { keyword: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { keyword: 'b', name: 'Bing', url: 'https://www.bing.com/search?q=%s', bangOnly: true },
  { keyword: 'yt', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s' },
  { keyword: 'w', name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Special:Search?search=%s', bangOnly: true },
  { keyword: 'wiki', name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Special:Search?search=%s' },
  { keyword: 'gh', name: 'GitHub', url: 'https://github.com/search?q=%s' },
  { keyword: 'maps', name: 'Google Maps', url: 'https://www.google.com/maps/search/%s' },
  { keyword: 'img', name: 'Google Images', url: 'https://www.google.com/search?tbm=isch&q=%s' },
  { keyword: 'news', name: 'Google News', url: 'https://news.google.com/search?q=%s' },
  { keyword: 'a', name: 'Amazon', url: 'https://www.amazon.com/s?k=%s', bangOnly: true },
  { keyword: 'r', name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s', bangOnly: true },
  { keyword: 'x', name: 'X', url: 'https://x.com/search?q=%s', bangOnly: true },
  { keyword: 'so', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s', bangOnly: true },
  { keyword: 'mdn', name: 'MDN Web Docs', url: 'https://developer.mozilla.org/en-US/search?q=%s' },
  { keyword: 'npm', name: 'npm', url: 'https://www.npmjs.com/search?q=%s' },
  { keyword: 'imdb', name: 'IMDb', url: 'https://www.imdb.com/find/?q=%s' },
  { keyword: 'tr', name: 'Google Translate', url: 'https://translate.google.com/?sl=auto&text=%s', bangOnly: true },
];

function getEngine(id, customUrl) {
  if (id === 'custom' && customUrl && customUrl.includes('%s')) {
    return { id: 'custom', name: 'Custom', search: customUrl, suggest: null, home: customUrl.split('?')[0] };
  }
  return SEARCH_ENGINES.find((e) => e.id === id) || SEARCH_ENGINES[0];
}

function fill(template, query) {
  return template.replace('%s', encodeURIComponent(query).replace(/%20/g, '+'));
}

function findKeyword(word) {
  const bang = word.startsWith('!');
  const w = word.replace(/^!/, '').toLowerCase();
  const k = KEYWORDS.find((entry) => entry.keyword === w) || null;
  if (k && k.bangOnly && !bang) return null;
  return k;
}

module.exports = { SEARCH_ENGINES, KEYWORDS, getEngine, fill, findKeyword };
