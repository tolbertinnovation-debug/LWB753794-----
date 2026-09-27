'use strict';

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, launch: launchApp, main, tabs, waitFor, activePage } = require('./harness');

// Every launched app is closed after each test, even when an assertion fails.
const running = new Set();
async function launch(opts) {
  const ctx = await launchApp(opts);
  running.add(ctx.app);
  ctx.app.on('close', () => running.delete(ctx.app));
  return ctx;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Sessions, shortcuts and permissions', { timeout: 240000 }, () => {
  let srv;
  before(async () => {
    srv = await startServer();
  });
  after(async () => {
    await srv?.close();
  });
  afterEach(async () => {
    for (const app of [...running]) await app.close().catch(() => {});
    running.clear();
  });

  it('restores windows, tabs, pinned state and back/forward history', async () => {
    let ctx = await launch();
    const { userData } = ctx;
    await main(ctx.app, (lib, base) => {
      const w = lib.windows.getFocusedWindow();
      w.activeTab.navigate(`${base}/index.html`);
      const t2 = w.createTab({ url: `${base}/page2.html` });
      w.togglePin(t2);
    }, srv.base);
    await waitFor(async () => (await tabs(ctx.app)).tabs.every((t) => !t.loading && t.title && t.title !== 'New Tab'), 10000, 'tabs loaded');
    // Build some history in the pinned tab.
    await main(ctx.app, (lib, base) => lib.windows.getFocusedWindow().activeTab.navigate(`${base}/article.html`), srv.base);
    await waitFor(async () => (await tabs(ctx.app)).tabs.some((t) => t.title.startsWith('A Short History')), 10000, 'article');
    await sleep(300);
    await ctx.app.close();

    ctx = await launch({ userData, env: { LIB_NO_RESTORE: '' } });
    const restored = await waitFor(async () => {
      const t = await tabs(ctx.app);
      return t.tabs.length === 2 ? t : null;
    }, 10000, 'restored tabs');
    assert.equal(restored.tabs[0].pinned, true, 'pinned tab comes first');
    assert.match(restored.tabs[0].url, /article\.html$/);
    assert.match(restored.tabs[1].url, /index\.html$/);
    const active = restored.tabs.find((t) => t.id === restored.activeId);
    assert.ok(active, 'an active tab');
    // The pinned tab keeps its back/forward history.
    await main(ctx.app, (lib) => {
      const w = lib.windows.getFocusedWindow();
      w.activateTab(w.tabs[0]);
    });
    await waitFor(async () => (await tabs(ctx.app)).tabs[0].canGoBack === true, 10000, 'history restored');
    await ctx.app.close();
  });

  // Playwright's synthetic keys bypass Electron's before-input-event, so this
  // test sends genuine X11 keystrokes (Linux + python-xlib only).
  const hasXkeys = (() => {
    if (process.platform !== 'linux' || !process.env.DISPLAY) return false;
    try {
      execFileSync('python3', ['-c', 'import Xlib']);
      return true;
    } catch {
      return false;
    }
  })();
  const key = (...combos) => execFileSync('python3', [path.join(__dirname, 'xkeys.py'), ...combos]);

  it('keyboard shortcuts work with real key presses', { skip: !hasXkeys && 'needs X11 + python-xlib' }, async () => {
    const ctx = await launch();
    const { app, chrome } = ctx;
    await main(app, (lib) => lib.windows.getFocusedWindow().win.focus());
    await sleep(400);
    key('ctrl+t');
    await waitFor(async () => (await tabs(app)).tabs.length === 2, 5000, 'Ctrl+T');
    key('ctrl+w');
    await waitFor(async () => (await tabs(app)).tabs.length === 1, 5000, 'Ctrl+W');
    key('ctrl+shift+a');
    await chrome.waitForSelector('.palette input');
    key('esc');
    await chrome.waitForSelector('.palette', { state: 'detached' });
    key('ctrl+l');
    await waitFor(() => chrome.evaluate(() => document.activeElement?.id === 'url-input'), 5000, 'Ctrl+L');

    // Page-first: an ordinary page doesn't handle Ctrl+F, so the browser does.
    await main(app, (lib, u) => lib.windows.getFocusedWindow().activeTab.navigate(u), `${srv.base}/index.html`);
    await waitFor(async () => (await tabs(app)).tabs[0].title === 'Fixture Home', 10000, 'home');
    await main(app, (lib) => lib.windows.getFocusedWindow().focusPage());
    await sleep(200);
    key('ctrl+f');
    await chrome.waitForSelector('#findbar:not([hidden])');
    key('esc');
    await chrome.waitForSelector('#findbar', { state: 'hidden' });

    // …but a web app that handles Ctrl+F itself keeps it.
    await main(app, (lib, u) => lib.windows.getFocusedWindow().activeTab.navigate(u), `${srv.base}/keys.html`);
    await waitFor(async () => (await tabs(app)).tabs[0].title === 'Key Capture', 10000, 'keys page');
    await main(app, (lib) => lib.windows.getFocusedWindow().focusPage());
    await sleep(200);
    key('ctrl+f');
    await sleep(500);
    const page = await activePage(ctx);
    assert.equal(await page.evaluate(() => window.captured), 1);
    assert.equal(await chrome.evaluate(() => document.getElementById('findbar').hidden), true);
    await app.close();
  });

  it('prompts for permissions and remembers the choice', async () => {
    const ctx = await launch();
    const { app, chrome } = ctx;
    await main(app, (lib, u) => lib.windows.getFocusedWindow().activeTab.navigate(u), `${srv.base}/page2.html`);
    await waitFor(async () => (await tabs(app)).tabs[0].title === 'Second Page', 10000, 'page');
    const page = await activePage(ctx);
    const result = page.evaluate(() => Notification.requestPermission());
    await chrome.waitForSelector('.infobar');
    assert.match(await chrome.textContent('.infobar'), /127\.0\.0\.1.*notifications/is);
    await chrome.click('.infobar .btn.primary');
    assert.equal(await result, 'granted');
    await chrome.waitForSelector('.infobar', { state: 'detached' });
    const stored = await main(app, (lib, origin) => lib.ctx.sitePrefs.getPermission(origin, 'notifications'), srv.base);
    assert.equal(stored, 'allow');
    // Second request is answered without prompting.
    assert.equal(await page.evaluate(() => Notification.requestPermission()), 'granted');
    await app.close();
  });

  it('sleeping tabs wake up with their history; duplicate keeps history', async () => {
    const ctx = await launch();
    const { app } = ctx;
    await main(app, (lib, base) => lib.windows.getFocusedWindow().activeTab.navigate(`${base}/index.html`), srv.base);
    await waitFor(async () => (await tabs(app)).tabs[0].title === 'Fixture Home', 10000, 'home');
    await main(app, (lib, base) => lib.windows.getFocusedWindow().activeTab.navigate(`${base}/page2.html`), srv.base);
    await waitFor(async () => (await tabs(app)).tabs[0].title === 'Second Page', 10000, 'page2');
    // Duplicate carries back/forward history.
    await main(app, (lib) => lib.commands.run('duplicateTab'));
    await waitFor(async () => {
      const t = await tabs(app);
      return t.tabs.length === 2 && t.tabs[1].canGoBack && !t.tabs[1].loading;
    }, 10000, 'duplicate with history');
    // Put the first tab to sleep, then wake it.
    const slept = await main(app, (lib) => {
      const w = lib.windows.getFocusedWindow();
      return w.tabs[0].discard();
    });
    assert.equal(slept, true);
    assert.equal((await tabs(app)).tabs[0].discarded, true);
    await main(app, (lib) => {
      const w = lib.windows.getFocusedWindow();
      w.activateTab(w.tabs[0]);
    });
    await waitFor(async () => {
      const t = (await tabs(app)).tabs[0];
      return !t.discarded && t.title === 'Second Page' && t.canGoBack;
    }, 10000, 'woke with history');
    await app.close();
  });

  it('HTTPS-Only mode upgrades and offers an HTTP fallback', async () => {
    const ctx = await launch();
    const { app } = ctx;
    await main(app, (lib) => lib.ctx.settings.set('httpsOnly', true));
    // A non-local host that won't resolve over HTTPS in the test environment.
    await main(app, (lib) => lib.windows.getFocusedWindow().activeTab.navigate('http://lib-https-only.invalid/'));
    const t = await waitFor(async () => {
      const x = (await tabs(app)).tabs[0];
      return x.errorCode ? x : null;
    }, 15000, 'error');
    assert.match(t.url, /^https:\/\/lib-https-only\.invalid/);
    await app.close();
  });
});
