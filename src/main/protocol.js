'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { protocol } = require('electron');
const ctx = require('./context');
const { INTERNAL_PAGES } = require('./url-utils');

const PAGES_DIR = path.join(__dirname, '..', 'pages');
const SHARED_DIR = path.join(PAGES_DIR, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Internal pages are privileged (they can call the browser API), so they get
// a strict CSP: no inline scripts, no remote scripts, no framing.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'lib',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, codeCache: true },
    },
  ]);
}

function respond(body, status, type, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': type,
      'content-security-policy': CSP,
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-cache',
      ...extraHeaders,
    },
  });
}

/** Resolve `rel` inside `root`, refusing anything that escapes it. */
function safeJoin(root, rel) {
  const target = path.normalize(path.join(root, rel));
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

async function handle(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return respond('Bad request', 400, 'text/plain');
  }
  const page = url.hostname;
  let rel = decodeURIComponent(url.pathname);

  // Custom new-tab background uploaded by the user.
  if (page === 'newtab' && rel === '/_bg/custom') {
    const file = path.join(ctx.userDataPath, 'ntp-background');
    try {
      const data = await fs.promises.readFile(file);
      const type = (await fs.promises.readFile(`${file}.type`, 'utf8').catch(() => 'image/jpeg')).trim();
      return respond(data, 200, type);
    } catch {
      return respond('Not found', 404, 'text/plain');
    }
  }

  let file;
  if (rel.startsWith('/_shared/')) {
    file = safeJoin(SHARED_DIR, rel.slice('/_shared/'.length));
  } else {
    if (!INTERNAL_PAGES.has(page)) return respond(notFoundPage(page), 404, MIME['.html']);
    if (rel === '/' || rel === '') rel = '/index.html';
    file = safeJoin(path.join(PAGES_DIR, page), rel);
  }
  if (!file) return respond('Forbidden', 403, 'text/plain');
  try {
    const data = await fs.promises.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return respond(data, 200, type);
  } catch {
    return respond(notFoundPage(page), 404, MIME['.html']);
  }
}

function notFoundPage(page) {
  const safe = String(page).replace(/[^a-z0-9-]/gi, '');
  return `<!doctype html><meta charset="utf-8"><title>Not found</title>
<link rel="stylesheet" href="/_shared/base.css">
<body class="center-page"><main class="empty"><h1>lib://${safe} doesn't exist</h1>
<p>That internal page couldn't be found.</p><p><a href="lib://newtab/">Open a new tab</a></p></main></body>`;
}

/** Register the lib:// handler on a session (each session needs its own). */
function attachProtocol(ses) {
  if (ses.protocol.isProtocolHandled('lib')) return;
  ses.protocol.handle('lib', handle);
}

module.exports = { registerSchemes, attachProtocol, PAGES_DIR };
