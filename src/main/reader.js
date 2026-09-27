'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Reader mode, powered by Mozilla's Readability (the engine behind Firefox
 * Reader View). Scripts run in an isolated world so pages can't tamper with
 * them, and the extracted article is rendered by lib://reader.
 */

const READER_WORLD = 1001;
const dir = path.dirname(require.resolve('@mozilla/readability'));
let readabilitySrc = null;
let readerableSrc = null;

function sources() {
  if (!readabilitySrc) {
    readabilitySrc = fs.readFileSync(path.join(dir, 'Readability.js'), 'utf8');
    readerableSrc = fs.readFileSync(path.join(dir, 'Readability-readerable.js'), 'utf8');
  }
  return { readabilitySrc, readerableSrc };
}

/** Articles extracted recently, keyed by random id (lib://reader/?id=…). */
const articles = new Map();

async function isReaderable(wc) {
  if (!wc || wc.isDestroyed()) return false;
  const url = wc.getURL();
  if (!/^https?:/i.test(url)) return false;
  try {
    const { readerableSrc: src } = sources();
    const code = `${src}\n;(() => { try { return isProbablyReaderable(document, { minContentLength: 180, minScore: 30 }); } catch (e) { return false; } })();`;
    return Boolean(await wc.executeJavaScriptInIsolatedWorld(READER_WORLD, [{ code }]));
  } catch {
    return false;
  }
}

async function extract(wc) {
  const { readabilitySrc: src } = sources();
  const code = `${src}\n;(() => {
    const doc = document.cloneNode(true);
    const article = new Readability(doc, { charThreshold: 300, keepClasses: false }).parse();
    if (!article) return null;
    return {
      title: article.title || document.title,
      byline: article.byline || '',
      siteName: article.siteName || location.hostname,
      excerpt: article.excerpt || '',
      content: article.content || '',
      length: article.length || 0,
      lang: article.lang || document.documentElement.lang || '',
      dir: article.dir || '',
      publishedTime: article.publishedTime || '',
      url: location.href,
    };
  })();`;
  const article = await wc.executeJavaScriptInIsolatedWorld(READER_WORLD, [{ code }]);
  if (!article || !article.content) return null;
  const id = crypto.randomBytes(8).toString('hex');
  articles.set(id, { ...article, createdAt: Date.now() });
  // Keep the cache small.
  if (articles.size > 30) articles.delete(articles.keys().next().value);
  return id;
}

function getArticle(id) {
  return articles.get(id) || null;
}

module.exports = { isReaderable, extract, getArticle };
