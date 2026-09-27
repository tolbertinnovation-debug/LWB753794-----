// Stroke icon set (24×24, currentColor). Kept as path data so they can be
// themed with CSS and rendered crisply at any size.
const P = {
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  arrowUp: '<path d="m18 15-6-6-6 6"/>',
  arrowDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  reload: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20 4v4.5h-4.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
  shield: '<path d="M12 21.5s7.5-3.6 7.5-9.5V5.5L12 2.8 4.5 5.5V12c0 5.9 7.5 9.5 7.5 9.5z"/>',
  shieldCheck: '<path d="M12 21.5s7.5-3.6 7.5-9.5V5.5L12 2.8 4.5 5.5V12c0 5.9 7.5 9.5 7.5 9.5z"/><path d="m9 11.8 2.2 2.2 4-4.2"/>',
  shieldOff: '<path d="M12 21.5s7.5-3.6 7.5-9.5V5.5L12 2.8 4.5 5.5V12c0 5.9 7.5 9.5 7.5 9.5z"/><path d="M4 4l16 16"/>',
  download: '<path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 20h15"/>',
  more: '<circle cx="12" cy="5.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.3" fill="currentColor" stroke="none"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  alert: '<path d="M10.3 4.2 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  globe: '<circle cx="12" cy="12" r="8.8"/><path d="M3.2 12h17.6M12 3.2c2.4 2.4 3.6 5.3 3.6 8.8s-1.2 6.4-3.6 8.8c-2.4-2.4-3.6-5.3-3.6-8.8S9.6 5.6 12 3.2z"/>',
  clock: '<circle cx="12" cy="12" r="8.8"/><path d="M12 7.2V12l3.2 2"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3 2"/>',
  bookmark: '<path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-3.8-6.5 3.8v-16a1 1 0 0 1 1-1z"/>',
  bookmarks: '<path d="M8 3.5h10a1 1 0 0 1 1 1v15l-5.5-3.2L8 19.5v-15a1 1 0 0 1 1-1z" transform="translate(-1.5 0)"/><path d="M19.5 7v13.5"/>',
  folder: '<path d="M3.5 7.2a1.7 1.7 0 0 1 1.7-1.7h4l2 2h7.6a1.7 1.7 0 0 1 1.7 1.7v8.6a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  volume: '<path d="M11 5.5 6.5 9H3.5v6h3l4.5 3.5z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 6.2a8.5 8.5 0 0 1 0 11.6"/>',
  volumeX: '<path d="M11 5.5 6.5 9H3.5v6h3l4.5 3.5z"/><path d="m21 9.5-5 5M16 9.5l5 5"/>',
  pin: '<path d="M9 3.5h6l-1 5.5 3.5 3v2h-11v-2L10 9z"/><path d="M12 14v6.5"/>',
  split: '<rect x="3" y="4.5" width="18" height="15" rx="2.2"/><path d="M12 4.5v15"/>',
  reader: '<path d="M3 5.5h5.5a3.5 3.5 0 0 1 3.5 3.5v10.5a2.6 2.6 0 0 0-2.6-2.6H3z"/><path d="M21 5.5h-5.5A3.5 3.5 0 0 0 12 9v10.5a2.6 2.6 0 0 1 2.6-2.6H21z"/>',
  camera: '<path d="M4.5 8h2.8l1.8-2.5h5.8L16.7 8h2.8a1.2 1.2 0 0 1 1.2 1.2v9a1.2 1.2 0 0 1-1.2 1.2h-15a1.2 1.2 0 0 1-1.2-1.2v-9A1.2 1.2 0 0 1 4.5 8z"/><circle cx="12" cy="13.3" r="3.3"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M11 8.3v5.4M8.3 11h5.4"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8.3 11h5.4"/>',
  fullscreen: '<path d="M8.5 3.5h-3a2 2 0 0 0-2 2v3M20.5 8.5v-3a2 2 0 0 0-2-2h-3M3.5 15.5v3a2 2 0 0 0 2 2h3M15.5 20.5h3a2 2 0 0 0 2-2v-3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5l.9 13a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-13"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  file: '<path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-9 8.5"/>',
  printer: '<path d="M6.5 9V3.5h11V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M6.5 14h11v6.5h-11z"/>',
  incognito: '<path d="M3 11.5h18"/><path d="m5.5 11.5 1.6-5.6a1.5 1.5 0 0 1 2-1l2.9 1.1 2.9-1.1a1.5 1.5 0 0 1 2 1l1.6 5.6"/><circle cx="7.5" cy="16.5" r="2.8"/><circle cx="16.5" cy="16.5" r="2.8"/><path d="M10.3 16.3c1.1-.6 2.3-.6 3.4 0"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  command: '<path d="M9 6.5A2.5 2.5 0 1 0 6.5 9H9zM15 6.5A2.5 2.5 0 1 1 17.5 9H15zM9 17.5A2.5 2.5 0 1 1 6.5 15H9zM15 17.5a2.5 2.5 0 1 0 2.5-2.5H15z"/><rect x="9" y="9" width="6" height="6"/>',
  translate: '<path d="M4 5.5h9M8.5 3.5v2M6 5.5c.5 3.5 3 6.3 6 7.5M11 5.5c-.6 3.7-3 6.5-6.5 7.8"/><path d="m12.5 20.5 4-9 4 9M14 17.5h5"/>',
  pip: '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><rect x="12" y="11.5" width="7" height="5.5" rx="1"/>',
  code: '<path d="m16 17.5 5.5-5.5L16 6.5M8 6.5 2.5 12 8 17.5"/>',
  activity: '<path d="M21.5 12h-4l-3 8.5-5-17-3 8.5h-4"/>',
  save: '<path d="M5 3.5h10.5l5 5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M7.5 3.5V8h7M7.5 20.5v-6.5h9v6.5"/>',
  info: '<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.2M12 7.8h.01"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  exit: '<path d="M9.5 20.5h-4a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5h4M16 16.5 20.5 12 16 7.5M20.5 12H9.5"/>',
  newWindow: '<rect x="3" y="4.5" width="18" height="15" rx="2.2"/><path d="M3 9h18"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
  check: '<path d="M20 6.5 9.5 17 4 11.5"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14"/>',
  play: '<path d="M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.5-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z"/>',
  sidebar: '<rect x="3" y="4.5" width="18" height="15" rx="2.2"/><path d="M9 4.5v15"/>',
  sad: '<circle cx="12" cy="12" r="8.8"/><path d="M8.6 16.4a4.8 4.8 0 0 1 6.8 0M9 9.8h.01M15 9.8h.01"/>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="2.2"/><path d="M8.5 7h7M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/>',
  zap: '<path d="M13 2.5 4 13.5h7.5l-1 8 9-11H12z"/>',
  layers: '<rect x="3.5" y="7.5" width="13" height="13" rx="2"/><path d="M7.5 3.5h11a2 2 0 0 1 2 2v11"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  compact: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  swap: '<path d="M7 7h13l-3.5-3.5M17 17H4l3.5 3.5"/>',
  broom: '<path d="M14.5 3.5 10 12"/><path d="M6 12h8.5l2 8.5H4z"/><path d="M8 16.5v4M12 16.5v4"/>',
  palette: '<circle cx="12" cy="12" r="8.8"/><circle cx="8" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1.2" fill="currentColor" stroke="none"/><path d="M12 20.8a2 2 0 0 1 0-4 2 2 0 0 0 0-4"/>',
  restore: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  help: '<circle cx="12" cy="12" r="8.8"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8M12 17h.01"/>',
};

export function icon(name, size = 18, cls = '') {
  const body = P[name] || P.globe;
  return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** The LIB brand mark (used for internal pages). */
export function logo(size = 18) {
  return `<svg class="lib-logo" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lg${size}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset=".55" stop-color="#6366f1"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#lg${size})"/><path d="M24 17v30h19" fill="none" stroke="#fff" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="43.5" cy="21.5" r="5.2" fill="#fff"/></svg>`;
}

export const ICON_NAMES = Object.keys(P);
