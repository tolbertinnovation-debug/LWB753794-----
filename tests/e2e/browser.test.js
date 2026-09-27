'use strict';

// End-to-end tests: drive the real browser (Electron) against a local
// fixture site. Run with `npm run test:e2e` (needs a display; CI uses xvfb).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, launch, main, tabs, waitFor, activePage } = require('./harness');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('LIB Browser', { timeout: 240000 }, () => {
  let srv;
  let ctx;
  let app;
  let chrome;

  before(async () => {
    srv = await startServer();
    ctx = await launch();
    app = ctx.app;
    chrome = ctx.chrome;
  });

  after(async () => {
    await app?.close().catch(() => {});
    await srv?.close();
  });

  const active = async () => {
    const t = await tabs(app);
    return t.tabs.find((x) => x.id === t.activeId);
  };
  const navigate = (url) => main(app, (lib, u) => lib.windows.getFocusedWindow().activeTab.navigate(u), url);
  const waitActive = (pred, what) =>
    waitFor(
      async () => {
        const t = await active();
        return t && pred(t) ? t : null;
      },
      10000,
      what,
    );

  it('starts with a New Tab page and a focused address bar', async () => {
    const t = await tabs(app);
    assert.equal(t.tabs.length, 1);
    assert.match(t.tabs[0].url, /^lib:\/\/newtab/);
    await waitFor(() => chrome.evaluate(() => document.activeElement?.id === 'url-input'), 5000, 'omnibox focus');
    const page = await activePage(ctx);
    await page.waitForSelector('#search');
    assert.equal(await page.evaluate(() => typeof window.lib), 'object', 'internal pages get the lib API');
  });

  it('navigates from the address bar and records history', async () => {
    await chrome.click('#url-input');
    await chrome.keyboard.type(`${srv.base}/index.html`);
    await chrome.keyboard.press('Enter');
    const tab = await waitActive((t) => t.title === 'Fixture Home', 'page title');
    assert.equal(tab.security, 'insecure');
    const hist = await main(app, (lib) => lib.ctx.history.query({}).map((v) => v.url));
    assert.ok(hist.some((u) => u.endsWith('/index.html')));
    // The UI shows the URL and the tab title.
    await waitFor(() => chrome.evaluate(() => document.querySelector('.tab.active .tab-title')?.textContent === 'Fixture Home'), 5000, 'tab title');
  });

  it('web pages cannot reach the internal API or lib:// pages', async () => {
    const page = await activePage(ctx);
    assert.equal(await page.evaluate(() => typeof window.lib), 'undefined');
    await page.evaluate(() => {
      location.href = 'lib://settings/';
    });
    await sleep(500);
    assert.match((await active()).url, /index\.html$/);
  });

  it('suggests history with inline autocomplete', async () => {
    await chrome.click('#url-input');
    await chrome.keyboard.type('127.0');
    await waitFor(() => chrome.evaluate(() => document.querySelectorAll('#omnibox-dropdown .sugg').length > 0), 5000, 'dropdown');
    const value = await chrome.evaluate(() => document.getElementById('url-input').value);
    assert.ok(value.startsWith('127.0.0.1:'), `inline completion, got ${value}`);
    await chrome.keyboard.press('Escape');
    await chrome.keyboard.press('Escape');
  });

  it('goes back and forward', async () => {
    const page = await activePage(ctx);
    // (DOM click: Playwright would otherwise wait on the lib:// navigation the
    // previous test proved is blocked.)
    await page.evaluate(() => document.getElementById('link2').click());
    await waitActive((t) => t.title === 'Second Page', 'page 2');
    assert.equal((await active()).canGoBack, true);
    await chrome.click('#btn-back');
    await waitActive((t) => t.title === 'Fixture Home', 'back');
    await chrome.click('#btn-forward');
    await waitActive((t) => t.title === 'Second Page', 'forward');
  });

  it('blocks ads and trackers, including cosmetic filters', async () => {
    await navigate(`${srv.base}/ads.html`);
    const tab = await waitActive((t) => t.title === 'Ads Page' && !t.loading, 'ads page');
    const page = await activePage(ctx);
    const flags = await page.evaluate(() => ({ ad: window.adLoaded, tracker: window.trackerLoaded }));
    assert.deepEqual(flags, { ad: false, tracker: false });
    await waitFor(() => page.evaluate(() => getComputedStyle(document.getElementById('banner')).display === 'none'), 5000, 'banner hidden');
    assert.ok(tab.blocked >= 2, `blocked count ${tab.blocked}`);
    const total = await main(app, (lib) => lib.ctx.adblock.totalBlocked);
    assert.ok(total >= 2);
  });

  it('allows ads on sites the user allowlists', async () => {
    await main(app, (lib) => lib.ctx.settings.set('adblockAllowlist', ['127.0.0.1']));
    await navigate(`${srv.base}/ads.html?again`);
    await waitActive((t) => t.url.endsWith('?again') && !t.loading, 'reload');
    const page = await activePage(ctx);
    await waitFor(() => page.evaluate(() => window.adLoaded === true), 5000, 'ad loaded when allowed');
    await main(app, (lib) => lib.ctx.settings.set('adblockAllowlist', []));
  });

  it('opens, switches and closes tabs; reopens closed tabs', async () => {
    await main(app, (lib) => lib.commands.run('newTab'));
    await waitFor(async () => (await tabs(app)).tabs.length === 2, 5000, 'two tabs');
    await navigate(`${srv.base}/page2.html`);
    await waitActive((t) => t.title === 'Second Page', 'page 2 in new tab');
    await main(app, (lib) => lib.commands.run('closeTab'));
    await waitFor(async () => (await tabs(app)).tabs.length === 1, 5000, 'closed');
    await main(app, (lib) => lib.commands.run('reopenClosed'));
    await waitFor(async () => (await tabs(app)).tabs.length === 2, 5000, 'reopened');
    await waitActive((t) => t.title === 'Second Page', 'restored page');
    // Clicking a tab in the strip activates it.
    const first = (await tabs(app)).tabs[0];
    await chrome.click(`.tab[data-id="${first.id}"] .tab-title`);
    await waitFor(async () => (await tabs(app)).activeId === first.id, 5000, 'activate by click');
  });

  it('opens target=_blank links in a new tab next to the opener', async () => {
    await navigate(`${srv.base}/index.html`);
    await waitActive((t) => t.title === 'Fixture Home', 'home');
    const before = (await tabs(app)).tabs.length;
    const page = await activePage(ctx);
    await page.click('#blank');
    await waitFor(async () => (await tabs(app)).tabs.length === before + 1, 5000, 'new tab from link');
    const t = await tabs(app);
    const opened = t.tabs.find((x) => x.url.endsWith('/page2.html') && x.openerTabId);
    assert.ok(opened, 'opened tab tracks its opener');
  });

  it('finds text in the page', async () => {
    await main(app, (lib) => {
      const w = lib.windows.getFocusedWindow();
      w.activateTab(w.tabs.find((t) => t.state.title === 'Fixture Home'));
    });
    await waitActive((t) => t.title === 'Fixture Home', 'home active');
    await main(app, (lib) => lib.commands.run('find'));
    await chrome.waitForSelector('#findbar:not([hidden])');
    await chrome.keyboard.type('pineapple');
    await waitFor(() => chrome.evaluate(() => /\/3$/.test(document.querySelector('.find-count').textContent)), 5000, 'find count');
    await chrome.keyboard.press('Escape');
    await chrome.waitForSelector('#findbar', { state: 'hidden' });
  });

  it('page-first shortcuts: web apps can handle Ctrl+F themselves', async () => {
    await navigate(`${srv.base}/keys.html`);
    await waitActive((t) => t.title === 'Key Capture' && !t.loading, 'keys page');
    const page = await activePage(ctx);
    await page.click('h1');
    await page.keyboard.press('Control+f');
    await sleep(300);
    assert.equal(await page.evaluate(() => window.captured), 1);
    assert.equal(await chrome.evaluate(() => document.getElementById('findbar').hidden), true, 'browser find bar stays closed');
  });

  it('bookmarks the current page with the star', async () => {
    await navigate(`${srv.base}/page2.html`);
    await waitActive((t) => t.title === 'Second Page' && !t.loading, 'page 2');
    await chrome.click('#btn-star');
    await waitFor(() => main(app, (lib, u) => lib.ctx.bookmarks.isBookmarked(u), `${srv.base}/page2.html`), 5000, 'bookmarked');
    await chrome.waitForSelector('form.dialog');
    await chrome.keyboard.press('Enter');
    await waitFor(() => chrome.evaluate(() => [...document.querySelectorAll('#bookmarks-bar .bm-item')].some((b) => b.textContent.includes('Second Page'))), 5000, 'bookmarks bar item');
    assert.equal((await active()).bookmarked, true);
  });

  it('downloads files', async () => {
    await navigate(`${srv.base}/index.html`);
    await waitActive((t) => t.title === 'Fixture Home' && !t.loading, 'home');
    const page = await activePage(ctx);
    await page.click('#dl');
    const file = path.join(ctx.downloads, 'report.txt');
    await waitFor(() => fs.existsSync(file) && fs.statSync(file).size > 1000, 10000, 'downloaded file');
    const rec = await waitFor(() => main(app, (lib) => lib.ctx.downloads.list().find((d) => d.filename === 'report.txt' && d.state === 'completed')), 5000, 'download record');
    assert.equal(rec.state, 'completed');
    await chrome.waitForSelector('#btn-downloads:not([hidden])');
  });

  it('asks for HTTP credentials', async () => {
    await navigate(`${srv.base}/auth`);
    await chrome.waitForSelector('form.dialog input[type=password]');
    await chrome.fill('form.dialog input[type=text]', 'lib');
    await chrome.fill('form.dialog input[type=password]', 'secret');
    await chrome.keyboard.press('Enter');
    await waitActive((t) => t.title === 'Authorized', 'authorized');
  });

  it('shows a friendly error page and keeps the failed URL', async () => {
    await navigate('http://127.0.0.1:1/');
    const t = await waitActive((x) => x.errorCode !== 0, 'error');
    assert.equal(t.url, 'http://127.0.0.1:1/');
    const heading = await waitFor(
      () => main(app, (lib) => lib.windows.getFocusedWindow().activeTab.webContents.executeJavaScript("document.querySelector('h1') && document.querySelector('h1').textContent")),
      5000,
      'error content',
    );
    assert.match(heading, /restricted|reached|working/i);
  });

  it('"Try again" on an error page reloads the failed address in place', async () => {
    const http = require('node:http');
    const probe = http.createServer();
    await new Promise((r) => probe.listen(0, '127.0.0.1', r));
    const { port } = probe.address();
    await new Promise((r) => probe.close(r));
    await navigate(`http://127.0.0.1:${port}/`);
    await waitActive((t) => t.errorCode === -102, 'connection refused');
    const late = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Back Online</title>ok');
    });
    await new Promise((r) => late.listen(port, '127.0.0.1', r));
    try {
      await waitFor(
        () => main(app, (lib) => lib.windows.getFocusedWindow().activeTab.webContents.executeJavaScript("!!document.querySelector('a.btn.primary')")),
        5000,
        'error page button',
      );
      await main(app, (lib) => lib.windows.getFocusedWindow().activeTab.webContents.executeJavaScript("document.querySelector('a.btn.primary').click()", true));
      await waitActive((t) => t.title === 'Back Online', 'reloaded');
    } finally {
      late.close();
    }
  });

  it('opens articles in reader mode', async () => {
    await navigate(`${srv.base}/article.html`);
    await waitActive((t) => t.readerable, 'readerable');
    await main(app, (lib) => lib.commands.run('reader'));
    await waitActive((t) => t.url.startsWith('lib://reader'), 'reader view');
    const page = await activePage(ctx);
    await page.waitForSelector('#content p');
    assert.equal(await page.textContent('#headline'), 'A Short History of Web Browsers');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#content script, nav').length), 0);
  });

  it('computes math in the address bar', async () => {
    await chrome.click('#url-input');
    await chrome.keyboard.type('12*12+1');
    await waitFor(() => chrome.evaluate(() => [...document.querySelectorAll('.sugg.calc .sugg-title')].some((e) => e.textContent === '= 145')), 5000, 'calc');
    await chrome.keyboard.press('Escape');
    await chrome.keyboard.press('Escape');
  });

  it('command palette finds open tabs', async () => {
    await main(app, (lib) => lib.commands.run('searchTabs'));
    await chrome.waitForSelector('.palette input');
    await chrome.keyboard.type('Second');
    await waitFor(() => chrome.evaluate(() => [...document.querySelectorAll('.palette .sugg-title')].some((e) => e.textContent === 'Second Page')), 5000, 'palette result');
    await chrome.keyboard.press('Escape');
  });

  it('split view shows two tabs side by side', async () => {
    const t = await tabs(app);
    await main(app, (lib, ids) => {
      const w = lib.windows.getFocusedWindow();
      w.openSplit(w.getTab(ids[0]), w.getTab(ids[1]));
    }, [t.tabs[0].id, t.tabs[1].id]);
    const layout = await waitFor(() => main(app, (lib) => lib.windows.getFocusedWindow()._layoutInfo), 3000, 'layout');
    assert.equal(layout.panes.length, 2);
    assert.ok(layout.divider);
    assert.ok(layout.panes[0].x + layout.panes[0].width <= layout.panes[1].x);
    await main(app, (lib) => lib.windows.getFocusedWindow().closeSplit());
  });

  it('settings changes apply live (theme, vertical tabs)', async () => {
    await main(app, (lib) => lib.ctx.settings.set('theme', 'dark'));
    await waitFor(() => chrome.evaluate(() => document.body.classList.contains('theme-dark')), 5000, 'dark theme');
    await main(app, (lib) => lib.ctx.settings.set('verticalTabs', true));
    await waitFor(() => chrome.evaluate(() => document.body.classList.contains('vertical-tabs') && document.querySelectorAll('#sidebar .vtab').length > 0), 5000, 'vertical tabs');
    await waitFor(() => main(app, (lib) => lib.windows.getFocusedWindow().insets.left > 100), 5000, 'sidebar inset');
    await main(app, (lib) => {
      lib.ctx.settings.set('verticalTabs', false);
      lib.ctx.settings.set('theme', 'light');
    });
  });

  it('private windows do not record history', async () => {
    const before = await main(app, (lib) => lib.ctx.history.query({}).length);
    const winId = await main(app, (lib, url) => lib.windows.createWindow({ isPrivate: true, url }).id, `${srv.base}/page2.html?private`);
    await waitFor(() => main(app, (lib, id) => lib.windows.get(id).activeTab.state.title === 'Second Page', winId), 10000, 'private page');
    const afterCount = await main(app, (lib) => lib.ctx.history.query({}).length);
    assert.equal(afterCount, before);
    const isolated = await main(app, (lib, id) => lib.windows.get(id).session !== lib.windows.all()[0].session, winId);
    assert.equal(isolated, true);
    // The private New Tab page renders its explainer.
    await main(app, (lib, id) => lib.windows.get(id).createTab(), winId);
    await waitFor(
      () => main(app, (lib, id) => lib.windows.get(id).activeTab.webContents.executeJavaScript("!document.body.classList.contains('loading') && !document.getElementById('private-info').hidden"), winId),
      8000,
      'private new tab page',
    );
    await main(app, (lib, id) => lib.windows.get(id).close(), winId);
  });

  it('sends Do Not Track and Global Privacy Control headers', async () => {
    await navigate(`${srv.base}/headers`);
    await waitActive((t) => t.url.endsWith('/headers') && !t.loading, 'headers');
    const page = await activePage(ctx);
    const headers = JSON.parse(await page.evaluate(() => document.body.innerText));
    assert.equal(headers.dnt, '1');
    assert.equal(headers['sec-gpc'], '1');
    assert.doesNotMatch(headers['user-agent'], /Electron|LIB/);
  });

  it('zooms per site and remembers it', async () => {
    await navigate(`${srv.base}/page2.html`);
    await waitActive((t) => t.title === 'Second Page' && !t.loading, 'page');
    await main(app, (lib) => lib.commands.run('zoomIn'));
    await waitActive((t) => t.zoom > 1, 'zoomed');
    const stored = await main(app, (lib) => lib.ctx.sitePrefs.getZoom('127.0.0.1'));
    assert.ok(stored > 1);
    await main(app, (lib) => lib.commands.run('zoomReset'));
    await waitActive((t) => t.zoom === 1, 'reset');
  });

  it('docks DevTools next to the page and closes them again', async () => {
    await navigate(`${srv.base}/page2.html`);
    await waitActive((t) => t.title === 'Second Page' && !t.loading, 'page');
    await main(app, (lib) => lib.commands.run('devtools'));
    const info = await waitFor(
      () => main(app, (lib) => {
        const w = lib.windows.getFocusedWindow();
        const t = w.activeTab;
        return t.devtoolsView && w.attached.has(t.devtoolsView) && w._layoutInfo.devtools ? { pageWidth: w._layoutInfo.panes[0].width } : null;
      }),
      8000,
      'docked devtools',
    );
    assert.ok(info.pageWidth < 1200);
    await main(app, (lib) => lib.commands.run('devtools'));
    await waitFor(() => main(app, (lib) => !lib.windows.getFocusedWindow().activeTab.devtoolsView), 5000, 'devtools closed');
  });

  it('saves screenshots to the downloads folder', async () => {
    await main(app, (lib) => lib.commands.run('screenshot'));
    await waitFor(() => fs.readdirSync(ctx.downloads).some((f) => f.startsWith('LIB Screenshot') && f.endsWith('.png')), 8000, 'screenshot file');
  });

  it('recovers crashed tabs', async () => {
    await main(app, (lib) => lib.windows.getFocusedWindow().activeTab.webContents.forcefullyCrashRenderer());
    await waitActive((t) => t.crashed, 'crashed');
    await waitFor(() => chrome.evaluate(() => !!document.querySelector('.sad-tab')), 5000, 'sad tab UI');
    await chrome.click('.sad-tab .btn');
    await waitActive((t) => !t.crashed && t.title === 'Second Page', 'reloaded');
  });

  it('moves a tab into its own window', async () => {
    await main(app, (lib, u) => lib.windows.getFocusedWindow().createTab({ url: u }), `${srv.base}/index.html`);
    await waitActive((t) => t.title === 'Fixture Home', 'new tab');
    const before = await main(app, (lib) => lib.windows.all().length);
    await main(app, (lib) => lib.commands.run('moveToNewWindow'));
    await waitFor(() => main(app, (lib, n) => lib.windows.all().length === n + 1, before), 5000, 'new window');
    const moved = await main(app, (lib) => {
      const w = lib.windows.all()[lib.windows.all().length - 1];
      return { tabs: w.tabs.length, title: w.activeTab.state.title };
    });
    assert.deepEqual(moved, { tabs: 1, title: 'Fixture Home' });
    if (process.env.LIB_E2E_DEBUG) console.log('windows before close', JSON.stringify(await main(app, (lib) => lib.windows.all().map((w) => ({ id: w.id, p: w.isPrivate, tabs: w.tabs.map((t) => t.state.url) })))));
    await main(app, (lib) => lib.windows.all()[lib.windows.all().length - 1].close());
    if (process.env.LIB_E2E_DEBUG) console.log('windows after close', JSON.stringify(await main(app, (lib) => lib.windows.all().map((w) => w.id))));
  });

  it('internal pages render (settings, history, bookmarks, downloads, about, shortcuts, tasks)', async () => {
    for (const page of ['settings', 'history', 'bookmarks', 'downloads', 'about', 'shortcuts', 'tasks']) {
      await navigate(`lib://${page}/`);
      await waitActive((t) => t.url.startsWith(`lib://${page}`) && !t.loading, page);
      const text = await waitFor(
        () => main(app, (lib) => lib.windows.getFocusedWindow().activeTab.webContents.executeJavaScript('document.body.innerText')).then((t) => (t.trim().length > 20 ? t : null)),
        8000,
        `${page} content`,
      );
      assert.ok(text.length > 20, page);
    }

  });
});
