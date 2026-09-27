'use strict';

const commands = require('./commands');

const IS_MAC = process.platform === 'darwin';
const REPEATABLE = new Set(['nextTab', 'prevTab', 'zoomIn', 'zoomOut', 'findNext', 'findPrev', 'back', 'forward', 'moveTabLeft', 'moveTabRight']);

const CODE_KEYS = {
  Equal: '=',
  Minus: '-',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  Numpad0: 'num0',
  Space: 'space',
};

const KEY_ALIASES = {
  plus: '+',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
  esc: 'escape',
  ' ': 'space',
  del: 'delete',
};

function normKey(k) {
  const lower = String(k).toLowerCase();
  return KEY_ALIASES[lower] || lower;
}

/** "CmdOrCtrl+Shift+T" → "ctrl+shift+t" (platform-resolved). */
function normalizeAccelerator(accel) {
  const parts = accel.split('+');
  // "CmdOrCtrl+Plus" and "CmdOrCtrl+=": the key is always the last segment.
  let key = parts.pop();
  if (key === '' && accel.endsWith('+')) key = '+';
  const mods = new Set();
  for (const p of parts) {
    const m = p.toLowerCase();
    if (m === 'cmdorctrl' || m === 'commandorcontrol') mods.add(IS_MAC ? 'meta' : 'ctrl');
    else if (m === 'cmd' || m === 'command' || m === 'super' || m === 'meta') mods.add('meta');
    else if (m === 'ctrl' || m === 'control') mods.add('ctrl');
    else if (m === 'alt' || m === 'option') mods.add('alt');
    else if (m === 'shift') mods.add('shift');
  }
  return combo(mods, normKey(key));
}

function combo(mods, key) {
  const order = ['ctrl', 'alt', 'shift', 'meta'];
  return [...order.filter((m) => mods.has(m)), key].join('+');
}

// combo → { id, pageFirst }
const TABLE = new Map();
for (const cmd of commands.COMMANDS) {
  for (const accel of cmd.keys || []) {
    TABLE.set(normalizeAccelerator(accel), { id: cmd.id, pageFirst: Boolean(cmd.pageFirst), accel });
  }
}

/** Candidate combos for a keyboard event (layout-aware with fallbacks). */
function candidates(input) {
  const mods = new Set();
  if (input.control) mods.add('ctrl');
  if (input.alt) mods.add('alt');
  if (input.shift) mods.add('shift');
  if (input.meta) mods.add('meta');
  const keys = [];
  const key = normKey(input.key || '');
  keys.push(key);
  const code = input.code || '';
  if (/^Key[A-Z]$/.test(code)) keys.push(code.slice(3).toLowerCase());
  else if (/^Digit[0-9]$/.test(code)) keys.push(code.slice(5));
  else if (CODE_KEYS[code]) keys.push(CODE_KEYS[code]);
  const out = [];
  for (const k of keys) {
    out.push(combo(mods, k));
    // Shifted punctuation ("+" is Shift+= on US keyboards) also matches unshifted.
    if (mods.has('shift') && k.length === 1 && !/[a-z0-9]/.test(k)) {
      const m = new Set(mods);
      m.delete('shift');
      out.push(combo(m, k));
    }
  }
  return out;
}

function match(input) {
  for (const c of candidates(input)) {
    const hit = TABLE.get(c);
    if (hit) return hit;
  }
  return null;
}

/** Pages where our preload can't report unhandled keys. */
function pageHandlesKeys(tab) {
  if (!tab || tab.errorInfo || tab.state.crashed || tab.state.discarded) return false;
  const url = tab.state.url || '';
  if (/^(view-source:|chrome-error:|about:)/.test(url)) return false;
  if (/\.pdf($|[?#])/i.test(url)) return false;
  return true;
}

/**
 * before-input-event handler for the UI view (`tab` = null) and tab views.
 */
function handleInput(win, event, input, tab) {
  if (input.type !== 'keyDown') return;
  const hit = match(input);
  if (!hit) return;
  const isPlainKey = !/[+]/.test(hit.accel) || /^Shift\+/.test(hit.accel);
  if (!tab && hit.pageFirst && isPlainKey) return; // e.g. Escape/F3 belong to the UI's own inputs
  if (tab && hit.pageFirst && pageHandlesKeys(tab)) {
    // Page gets it first; the preload reports it back if unhandled. Remember
    // the real keypress so pages can't spoof shortcut messages.
    tab._pageFirstKey = { id: hit.id, time: Date.now() };
    return;
  }
  if (IS_MAC && !hit.pageFirst) return; // the application menu owns these on macOS
  if (input.isAutoRepeat && !REPEATABLE.has(hit.id)) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  commands.run(hit.id, { win, tab: win.activeTab });
}

/** A key the page didn't handle (reported by the page preload). */
function handleUnhandledKey(win, tab, input) {
  const hit = match(input);
  if (!hit || !hit.pageFirst) return;
  const pending = tab._pageFirstKey;
  if (!pending || pending.id !== hit.id || Date.now() - pending.time > 1500) return;
  tab._pageFirstKey = null;
  commands.run(hit.id, { win, tab: win.activeTab || tab });
}

module.exports = { handleInput, handleUnhandledKey, match, normalizeAccelerator };
