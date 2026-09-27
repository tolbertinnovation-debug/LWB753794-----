'use strict';

// Shared harness for end-to-end tests: a local fixture web server and a
// launcher that starts LIB Browser with an isolated profile via Playwright.

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const SITE = path.join(ROOT, 'tests', 'fixtures', 'site');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.gif': 'image/gif', '.txt': 'text/plain' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/download/')) {
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="${path.basename(url.pathname)}"`,
        });
        res.end('LIB Browser download test file\n'.repeat(200));
        return;
      }
      if (url.pathname === '/auth') {
        const expected = `Basic ${Buffer.from('lib:secret').toString('base64')}`;
        if (req.headers.authorization !== expected) {
          res.writeHead(401, { 'www-authenticate': 'Basic realm="Fixture Realm"', 'content-type': 'text/html' });
          res.end('<title>Unauthorized</title>denied');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<title>Authorized</title><h1>Welcome, authorized user</h1>');
        return;
      }
      if (url.pathname === '/headers') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(req.headers));
        return;
      }
      let file = path.normalize(path.join(SITE, url.pathname === '/' ? 'index.html' : url.pathname));
      if (!file.startsWith(SITE)) file = path.join(SITE, 'index.html');
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404, { 'content-type': 'text/html' });
          res.end('<title>Not Found</title>404');
          return;
        }
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function electronPath() {
  return require('electron');
}

/**
 * Launch the browser.
 * @param {{ userData?: string, env?: object, args?: string[] }} [opts]
 */
async function launch(opts = {}) {
  const userData = opts.userData || fs.mkdtempSync(path.join(os.tmpdir(), 'lib-e2e-'));
  const downloads = path.join(userData, 'Downloads');
  fs.mkdirSync(downloads, { recursive: true });
  const args = [...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []), ROOT, ...(opts.args || [])];
  const app = await electron.launch({
    executablePath: electronPath(),
    args,
    env: {
      ...process.env,
      LIB_USER_DATA: userData,
      LIB_TEST: '1',
      LIB_TEST_ADBLOCK_LIST: path.join(ROOT, 'tests', 'fixtures', 'filters.txt'),
      LIB_TEST_DOWNLOADS: downloads,
      ...(opts.env || {}),
    },
  });
  const ctx = { app, userData, downloads };
  if (process.env.LIB_E2E_DEBUG) {
    const watch = (p) => {
      p.on('console', (m) => m.type() === 'error' && console.log(`[console ${p.url().slice(0, 60)}]`, m.text()));
      p.on('pageerror', (e) => console.log(`[pageerror ${p.url().slice(0, 60)}]`, e.message));
    };
    app.windows().forEach(watch);
    app.on('window', watch);
    app.process().stderr.on('data', (d) => /\[(main|ipc|command|network)/.test(String(d)) && process.stdout.write(`[main] ${d}`));
  }
  ctx.chrome = await waitFor(async () => app.windows().find((w) => w.url().includes('renderer/index.html')), 15000, 'browser UI');
  await ctx.chrome.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 15000 });
  return ctx;
}

async function waitFor(fn, timeout = 10000, what = 'condition') {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
}

/** Evaluate in the main process with access to the browser internals. */
function main(app, fn, arg) {
  return app.evaluate(({ app: _a }, [src, a]) => {
    // eslint-disable-next-line no-new-func
    const f = new Function('lib', 'arg', `return (${src})(lib, arg);`);
    return f(globalThis.__lib, a);
  }, [fn.toString(), arg]);
}

/** Snapshot of the focused window's tabs. */
function tabs(app) {
  return main(app, (lib) => {
    const w = lib.windows.getFocusedWindow();
    return { activeId: w.activeTab && w.activeTab.id, tabs: w.tabs.map((t) => t.snapshot()) };
  });
}

/** Playwright Page for the active tab's WebContents. */
async function activePage(ctx) {
  const url = await main(ctx.app, (lib) => lib.windows.getFocusedWindow().activeTab.webContents.getURL());
  return waitFor(() => ctx.app.windows().find((w) => w.url() === url), 10000, `page ${url}`);
}

module.exports = { startServer, launch, waitFor, main, tabs, activePage, ROOT };
