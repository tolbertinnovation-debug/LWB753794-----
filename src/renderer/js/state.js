import { Emitter } from './util.js';

/** Global UI state + event bus for the browser chrome. */
export const bus = new Emitter();

export const state = {
  windowId: 0,
  isPrivate: false,
  platform: 'linux',
  tabs: [],
  activeId: null,
  split: null,
  settings: {},
  bookmarksBar: [],
  downloads: { active: 0, progress: 0, recent: [] },
  commands: [],
  maximized: false,
  fullscreen: false,
  htmlFullscreen: false,
  layout: { panes: [], divider: null, devtools: null },
};

export function activeTab() {
  return state.tabs.find((t) => t.id === state.activeId) || null;
}

export const api = window.lib;

/** Call a browser method (async, returns a result). */
export function invoke(method, ...args) {
  return api.invoke(method, ...args);
}

/** Fire-and-forget browser call. */
export function send(method, ...args) {
  api.send(method, ...args);
}

export function command(id, arg) {
  send('command', id, arg);
}
