'use strict';

const { desktopCapturer, Menu } = require('electron');
const ctx = require('./context');
const { originOf } = require('./url-utils');

/** Harmless capabilities granted without asking (same as Chrome). */
const AUTO_ALLOW = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'keyboardLock',
  'persistent-storage',
  'background-sync',
  'speaker-selection',
  'mediaKeySystem',
  'screen-wake-lock',
  'fileSystem',
]);

/** Capabilities that require the user's consent, with human-readable text. */
const PROMPTABLE = {
  camera: 'Use your camera',
  microphone: 'Use your microphone',
  geolocation: 'Know your location',
  notifications: 'Show notifications',
  'clipboard-read': 'See text and images copied to the clipboard',
  'display-capture': 'Share your screen',
  midi: 'Control MIDI devices',
  midiSysex: 'Control and reprogram MIDI devices',
  'idle-detection': 'Know when you are actively using this device',
  openExternal: 'Open an external application',
  hid: 'Connect to HID devices',
  serial: 'Connect to serial ports',
  usb: 'Connect to USB devices',
  'local-fonts': 'Use fonts installed on your computer',
  'window-management': 'Manage windows on all your displays',
  'storage-access': 'Use cookies and site data in embedded content',
  'top-level-storage-access': 'Use cookies and site data in embedded content',
  sensors: 'Use motion sensors',
};

let nextRequestId = 1;

function findTab(wc) {
  return require('./windows').findTabByWebContents(wc);
}

/** Expand an Electron permission request into the keys we store decisions under. */
function keysFor(permission, details) {
  if (permission === 'media') {
    const types = details?.mediaTypes || [];
    const keys = [];
    if (types.includes('video')) keys.push('camera');
    if (types.includes('audio')) keys.push('microphone');
    return keys.length ? keys : ['camera', 'microphone'];
  }
  return [permission];
}

class PermissionManager {
  constructor() {
    /** @type {Map<number, { tab: any, origin: string, keys: string[], callbacks: Function[] }>} */
    this.pending = new Map();
  }

  attach(ses, { isPrivate }) {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      this._onRequest(wc, permission, callback, details, isPrivate);
    });
    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      if (AUTO_ALLOW.has(permission)) return true;
      const origin = requestingOrigin || details?.requestingUrl || (wc && wc.getURL());
      if (/^lib:/.test(origin || '')) return permission === 'clipboard-read';
      const keys = permission === 'media' ? ['camera', 'microphone'] : [permission];
      const o = originOf(origin);
      return keys.some((k) => ctx.sitePrefs.getPermission(o, k) === 'allow');
    });
    ses.setDisplayMediaRequestHandler(
      (request, callback) => this._onDisplayMedia(request, callback),
      { useSystemPicker: true },
    );
  }

  _onRequest(wc, permission, callback, details, isPrivate) {
    if (AUTO_ALLOW.has(permission)) return callback(true);
    const url = details?.requestingUrl || wc.getURL();
    const origin = originOf(url);
    if (/^lib:/.test(url)) return callback(permission === 'clipboard-read' || permission === 'notifications');
    const keys = keysFor(permission, details);
    if (!keys.every((k) => k in PROMPTABLE)) return callback(false);

    const decisions = keys.map((k) => ctx.sitePrefs.getPermission(origin, k));
    if (decisions.every((d) => d === 'allow')) return callback(true);
    if (decisions.some((d) => d === 'block')) return callback(false);

    const tab = findTab(wc);
    if (!tab) return callback(false);
    // Merge with an identical pending request from the same tab.
    for (const req of this.pending.values()) {
      if (req.tab === tab && req.origin === origin && req.keys.join() === keys.join()) {
        req.callbacks.push(callback);
        return;
      }
    }
    const id = nextRequestId++;
    this.pending.set(id, { id, tab, origin, keys, callbacks: [callback], isPrivate });
    tab.win.showPermissionPrompt({
      id,
      tabId: tab.id,
      origin,
      host: (() => {
        try {
          return new URL(origin).host;
        } catch {
          return origin;
        }
      })(),
      items: keys.map((k) => ({ key: k, label: PROMPTABLE[k] })),
    });
  }

  /** Called by the UI with the user's decision. */
  respond(id, allow, remember = true) {
    const req = this.pending.get(id);
    if (!req) return;
    this.pending.delete(id);
    if (remember && !req.isPrivate) {
      for (const k of req.keys) ctx.sitePrefs.setPermission(req.origin, k, allow ? 'allow' : 'block');
    }
    for (const cb of req.callbacks) {
      try {
        cb(Boolean(allow));
      } catch {
        /* ignore */
      }
    }
    req.tab.win?.hidePermissionPrompt(id);
  }

  /** Deny and dismiss all prompts belonging to a tab (on navigation/close). */
  cancelForTab(tab) {
    for (const [id, req] of this.pending) {
      if (req.tab === tab) {
        this.pending.delete(id);
        req.callbacks.forEach((cb) => {
          try {
            cb(false);
          } catch {
            /* ignore */
          }
        });
        tab.win?.hidePermissionPrompt(id);
      }
    }
  }

  pendingForTab(tab) {
    return [...this.pending.values()].filter((r) => r.tab === tab);
  }

  async _onDisplayMedia(request, callback) {
    const wc = request.frame?.top ? require('electron').webContents.fromFrame(request.frame) : null;
    const tab = wc ? findTab(wc) : null;
    const origin = originOf(request.securityOrigin || request.frame?.url || '');
    // Screen sharing always asks (never remembered), like Chrome.
    const allowed = await new Promise((resolve) => {
      if (!tab) return resolve(false);
      const id = nextRequestId++;
      this.pending.set(id, { id, tab, origin, keys: ['display-capture'], callbacks: [resolve], isPrivate: true });
      tab.win.showPermissionPrompt({
        id,
        tabId: tab.id,
        origin,
        host: origin.replace(/^https?:\/\//, ''),
        items: [{ key: 'display-capture', label: PROMPTABLE['display-capture'] }],
        noRemember: true,
      });
    });
    if (!allowed) return callback({});
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      if (!sources.length) return callback({});
      if (sources.length === 1) return callback({ video: sources[0] });
      let chosen = false;
      const menu = Menu.buildFromTemplate([
        { label: 'Choose what to share', enabled: false },
        { type: 'separator' },
        ...sources.map((s) => ({
          label: s.id.startsWith('screen') ? `Entire screen — ${s.name}` : `Window — ${s.name}`,
          click: () => {
            chosen = true;
            callback(process.platform === 'win32' ? { video: s, audio: 'loopback' } : { video: s });
          },
        })),
      ]);
      // 'menu-will-close' can fire before the click handler; give it a moment.
      menu.on('menu-will-close', () => setTimeout(() => !chosen && callback({}), 150));
      menu.popup({ window: tab.win.win });
    } catch (err) {
      console.error('[permissions] display media', err);
      callback({});
    }
  }
}

module.exports = { PermissionManager, PROMPTABLE };
