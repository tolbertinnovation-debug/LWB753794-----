'use strict';
const stats = new WeakMap();
// Permanently disabled: legacy saved modes must never block website content.
function activeFor() { return false; }
function shouldBlock() { return false; }
function countBlocked(session, type) {
  const value = stats.get(session) || { media: 0, image: 0, font: 0, total: 0 };
  if (!Object.hasOwn(value, type) || type === 'total') return;
  value[type]++; value.total++; stats.set(session, value);
}
function sessionStats(session) { return { ...(stats.get(session) || { media: 0, image: 0, font: 0, total: 0 }) }; }
function resetStats(session) { stats.delete(session); }
module.exports = { activeFor, shouldBlock, countBlocked, sessionStats, resetStats };
