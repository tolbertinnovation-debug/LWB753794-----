'use strict';

// Preload for every tab. For web pages it only reports keyboard shortcuts the
// page didn't handle and mouse back/forward buttons. Internal lib:// pages
// additionally get the `window.lib` API (verified again in the main process).
const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener(
  'keydown',
  (e) => {
    if (!e.isTrusted) return;
    const fn = /^F\d{1,2}$/.test(e.key);
    if (!(e.ctrlKey || e.metaKey || fn || e.key === 'Escape')) return;
    // Wait until the event finished dispatching, then check if the page
    // consumed it (preventDefault). If not, the browser handles it.
    setTimeout(() => {
      if (e.defaultPrevented) return;
      ipcRenderer.send('lib:unhandled-key', {
        key: e.key,
        code: e.code,
        control: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey,
      });
    }, 0);
  },
  false,
);

window.addEventListener(
  'mouseup',
  (e) => {
    if (!e.isTrusted) return;
    if (e.button === 3) ipcRenderer.send('lib:mouse-nav', 'back');
    else if (e.button === 4) ipcRenderer.send('lib:mouse-nav', 'forward');
  },
  true,
);

if (location.protocol === 'lib:') {
  const handlers = new Map();
  ipcRenderer.on('lib:page-event', (_event, name, payload) => {
    for (const cb of handlers.get(name) || []) {
      try {
        cb(payload);
      } catch (err) {
        console.error(err);
      }
    }
  });
  contextBridge.exposeInMainWorld('lib', {
    call: (method, ...args) => ipcRenderer.invoke('lib:page', method, ...args),
    on: (name, cb) => {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(cb);
    },
    platform: process.platform,
  });
}
