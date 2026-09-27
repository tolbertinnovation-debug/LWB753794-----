'use strict';

// Bridge for the browser UI (tab strip, toolbar, popups). Runs sandboxed with
// context isolation; exposes a minimal, typed-by-convention API.
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('lib:event', (_event, name, payload) => {
  for (const cb of listeners) {
    try {
      cb(name, payload);
    } catch (err) {
      console.error(err);
    }
  }
});

contextBridge.exposeInMainWorld('lib', {
  /** Call a browser method and await its result. */
  invoke: (method, ...args) => ipcRenderer.invoke('lib:chrome', method, ...args),
  /** Fire-and-forget call (layout updates, drags). */
  send: (method, ...args) => ipcRenderer.send('lib:chrome-send', method, ...args),
  /** Subscribe to browser events: cb(name, payload). */
  onEvent: (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
});
