'use strict';
const { INTERNAL_PAGES } = require('./url-utils');
function apiMethod(api, name) {
  return typeof name === 'string' && Object.hasOwn(api, name) && typeof api[name] === 'function' ? api[name] : null;
}
function trustedInternalFrame(frame) {
  if (!frame || frame.parent) return false;
  try { const url = new URL(frame.url); return url.protocol === 'lib:' && !url.username && !url.password && !url.port && INTERNAL_PAGES.has(url.hostname); } catch { return false; }
}
function securePermissionOrigin(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}
const EXTERNAL_SCHEMES = new Set(['mailto:', 'tel:', 'sms:', 'zoommtg:', 'msteams:', 'slack:', 'spotify:', 'magnet:']);
function safeExternalLink(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f]/.test(value)) return false;
  try { const url = new URL(value); return EXTERNAL_SCHEMES.has(url.protocol) && !url.username && !url.password; } catch { return false; }
}
module.exports = { apiMethod, trustedInternalFrame, securePermissionOrigin, safeExternalLink };
