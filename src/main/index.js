'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, session, nativeTheme, crashReporter } = require('electron');

// ------------------------------------------------------------------ early setup
app.setName('LIB Browser');
if (process.env.LIB_USER_DATA) app.setPath('userData', path.resolve(process.env.LIB_USER_DATA));
if (process.platform === 'win32') app.setAppUserModelId('com.lib.browser');

const ctx = require('./context');
ctx.isTest = process.env.LIB_TEST === '1';
ctx.userDataPath = app.getPath('userData');

// Single instance: a second launch (e.g. clicking a link in another app)
// opens its URLs in the running browser instead.
if (!ctx.isTest && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const { registerSchemes, attachProtocol } = require('./protocol');
registerSchemes();

app.commandLine.appendSwitch('enable-smooth-scrolling');
if (ctx.isTest) app.commandLine.appendSwitch('disable-gpu-sandbox');
crashReporter.start({ uploadToServer: false });

const { Settings } = require('./settings');
const { History } = require('./history');
const { Bookmarks } = require('./bookmarks');
const { DownloadManager } = require('./downloads');
const { PermissionManager } = require('./permissions');
const { SitePrefs } = require('./site-prefs');
const { AdBlocker } = require('./adblock');
const { SessionState } = require('./session-state');

/** URLs/files passed on the command line (or by the OS when set as default browser). */
function urlsFromArgv(argv, cwd = process.cwd()) {
  const out = [];
  // Skip the executable (and the app path when running unpackaged).
  const args = argv.slice(app.isPackaged ? 1 : 2);
  for (const a of args) {
    if (!a || a.startsWith('-')) continue;
    if (/^(https?|file|lib|about):/i.test(a)) {
      out.push(a);
      continue;
    }
    const p = path.resolve(cwd, a);
    try {
      if (fs.statSync(p).isFile()) out.push(require('node:url').pathToFileURL(p).href);
    } catch {
      /* not a file */
    }
  }
  return out;
}

let pendingOpenUrls = [];
let ready = false;

function openUrls(urls) {
  const windows = require('./windows');
  if (!urls.length) {
    windows.createWindow();
    return;
  }
  const win = windows.getWindowOfKind(false);
  if (!win) {
    windows.createWindow({ urls });
    return;
  }
  urls.forEach((url, i) => win.createTab({ url, background: i > 0 }));
  if (win.win.isMinimized()) win.win.restore();
  win.win.focus();
}

app.on('second-instance', (_event, argv, cwd) => {
  if (!ready) return;
  openUrls(urlsFromArgv(argv, cwd));
});

// macOS: links opened while we're the default browser.
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (ready) openUrls([url]);
  else pendingOpenUrls.push(url);
});
app.on('open-file', (event, file) => {
  event.preventDefault();
  const url = require('node:url').pathToFileURL(file).href;
  if (ready) openUrls([url]);
  else pendingOpenUrls.push(url);
});

function initServices() {
  const dir = ctx.userDataPath;
  ctx.settings = new Settings(path.join(dir, 'settings.json'), app.getPath('downloads'));
  ctx.history = new History(path.join(dir, 'history.json'));
  ctx.bookmarks = new Bookmarks(path.join(dir, 'bookmarks.json'));
  ctx.downloads = new DownloadManager(path.join(dir, 'downloads.json'));
  ctx.permissions = new PermissionManager();
  ctx.sitePrefs = new SitePrefs(path.join(dir, 'site-prefs.json'));
  ctx.adblock = new AdBlocker(dir);
  ctx.sessionState = new SessionState(path.join(dir, 'session.json'));
  nativeTheme.themeSource = ctx.settings.get('theme');
}

function flushAll() {
  for (const key of ['settings', 'history', 'bookmarks', 'downloads', 'sitePrefs', 'adblock']) {
    try {
      ctx[key]?.flush();
    } catch (err) {
      console.error(`[flush] ${key}`, err);
    }
  }
}

/** Put long-unused background tabs to sleep to save memory. */
function startTabSleeper() {
  const timer = setInterval(() => {
    if (!ctx.settings.get('tabSleepEnabled')) return;
    const limit = (ctx.settings.get('tabSleepMinutes') || 30) * 60 * 1000;
    const now = Date.now();
    for (const tab of require('./windows').allTabs()) {
      if (tab.webContents && !tab.isActive && now - tab.lastActive > limit && !tab.state.pinned) tab.discard();
    }
  }, 60 * 1000);
  timer.unref?.();
}

app.whenReady().then(async () => {
  initServices();
  attachProtocol(session.defaultSession); // lets the UI show lib:// favicons

  const adblockReady = ctx.adblock.init().catch((err) => console.warn('[adblock] init failed', err));
  if (ctx.isTest) await adblockReady; // deterministic tests

  require('./ipc').register();
  require('./menus').buildApplicationMenu();

  const windows = require('./windows');
  const argvUrls = urlsFromArgv(process.argv);
  const startup = ctx.settings.get('startup');
  const saved = ctx.sessionState.savedWindows();
  const initialUrls = [...pendingOpenUrls, ...argvUrls];
  pendingOpenUrls = [];

  if (!ctx.settings.get('onboarded') && !ctx.isTest) {
    windows.createWindow({ urls: ['lib://welcome/', ...initialUrls] });
  } else if (startup === 'restore' && saved.length && !process.env.LIB_NO_RESTORE) {
    for (const w of saved) windows.createWindow({ ...w, bounds: w.bounds });
    if (initialUrls.length) openUrls(initialUrls);
  } else if (initialUrls.length) {
    windows.createWindow({ urls: initialUrls });
  } else if (startup === 'homepage') {
    windows.createWindow({ url: ctx.settings.get('homepage') || 'lib://newtab/' });
  } else {
    windows.createWindow();
  }
  ready = true;
  startTabSleeper();
  // Periodically persist the session for crash recovery.
  setInterval(() => ctx.sessionState.scheduleSave(), 30 * 1000).unref?.();

  if (ctx.isTest) globalThis.__lib = { ctx, windows: require('./windows'), commands: require('./commands') };
});

app.on('activate', () => {
  // macOS: clicking the dock icon with no windows open.
  if (ready && !require('./windows').all().length) require('./windows').createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let clearedOnExit = false;
app.on('before-quit', (event) => {
  if (ctx.settings?.get('clearOnExit') && !clearedOnExit) {
    // Wipe history, cookies and cache before exiting (async, so quit again after).
    event.preventDefault();
    clearedOnExit = true;
    try {
      ctx.sessionState?.freeze();
    } catch {
      /* ignore */
    }
    ctx.quitting = true;
    require('./ipc')
      .clearBrowsingData({ range: 'all', history: true, cookies: true, cache: true })
      .catch(() => {})
      .finally(() => app.quit());
    return;
  }
  if (ctx.quitting && !clearedOnExit) return;
  ctx.quitting = true;
  try {
    if (!clearedOnExit) ctx.sessionState?.freeze();
  } catch (err) {
    console.error('[quit] session', err);
  }
  flushAll();
});

app.on('will-quit', () => {
  flushAll();
});

process.on('uncaughtException', (err) => {
  console.error('[main] uncaught exception', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[main] unhandled rejection', err);
});
