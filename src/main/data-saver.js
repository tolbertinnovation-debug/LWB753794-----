'use strict';
const stats = new WeakMap();
function activeFor(settings, pageUrl) {
  if (!['balanced', 'maximum'].includes(settings.get('dataSaverMode'))) return false;
  try {
    const url = new URL(pageUrl);
    return ['http:', 'https:'].includes(url.protocol) && !(settings.get('dataSaverAllowlist') || []).includes(url.hostname.toLowerCase());
  } catch { return false; }
}
function shouldBlock(settings, details, pageUrl) {
  if (!activeFor(settings, pageUrl) || !/^https?:\/\//i.test(details.url)) return false;
  return details.resourceType === 'media' || (settings.get('dataSaverMode') === 'maximum' && ['image', 'font'].includes(details.resourceType));
}
function countBlocked(session, type) {
  const value = stats.get(session) || { media: 0, image: 0, font: 0, total: 0 };
  if (!Object.hasOwn(value, type) || type === 'total') return;
  value[type]++; value.total++; stats.set(session, value);
}
function sessionStats(session) { return { ...(stats.get(session) || { media: 0, image: 0, font: 0, total: 0 }) }; }
function resetStats(session) { stats.delete(session); }
module.exports = { activeFor, shouldBlock, countBlocked, sessionStats, resetStats };
