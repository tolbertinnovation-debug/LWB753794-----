'use strict';

// Explicit copy action only: leave navigation URLs and required query fields intact.
function cleanLink(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return value;
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch { return value; }
}

// Exact URLs only; prefer the active, then pinned tab. Never discard protected work.
function duplicateTabs(tabs, activeTab) {
  const kept = new Map();
  const duplicates = [];
  const ordered = [...tabs].sort((a, b) => Number(b === activeTab) - Number(a === activeTab) || Number(Boolean(b.state.pinned)) - Number(Boolean(a.state.pinned)));
  for (const tab of ordered) {
    if (!/^https?:\/\//i.test(tab.state.url)) continue;
    if (!kept.has(tab.state.url)) kept.set(tab.state.url, tab);
    else if (!tab.state.pinned && !tab.state.audible && !tab.state.loading) duplicates.push(tab);
  }
  return duplicates;
}

function boundedHistory(entries, index, limit = 50) {
  if (!entries.length) return { entries: [], index: -1 };
  const active = Math.max(0, Math.min(index, entries.length - 1));
  const start = Math.max(0, Math.min(active - Math.floor(limit / 2), entries.length - limit));
  const kept = entries.slice(start, start + limit);
  return { entries: kept, index: active - start };
}

module.exports = { cleanLink, duplicateTabs, boundedHistory };
