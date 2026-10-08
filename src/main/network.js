'use strict';

const { webContents } = require('electron');
const { getDomain } = require('tldts');
const ctx = require('./context');
const dataSaver = require('./data-saver');
const { isLocalHost } = require('./url-utils');

/**
 * Electron allows exactly one listener per webRequest event per session, so
 * every network feature (ad blocking, HTTPS-Only, DNT/GPC, third-party cookie
 * blocking) is composed here into a single pipeline.
 */

function tabForWebContentsId(id) {
  if (!id) return null;
  // Lazy require: windows.js depends (indirectly) on this module.
  return require('./windows').findTabByWebContentsId(id);
}

/** URL of the top-level page that issued a request. */
function pageUrlFor(details) {
  const tab = tabForWebContentsId(details.webContentsId);
  if (tab) return tab.state.url;
  try {
    const top = details.frame?.top;
    if (top && top.url) return top.url;
  } catch {
    /* frame gone */
  }
  try {
    const wc = details.webContentsId && webContents.fromId(details.webContentsId);
    if (wc && !wc.isDestroyed()) return wc.getURL();
  } catch {
    /* ignore */
  }
  return details.referrer || '';
}

function siteOf(url) {
  try {
    const u = new URL(url);
    return getDomain(u.hostname, { allowPrivateDomains: true }) || u.hostname;
  } catch {
    return '';
  }
}

function isThirdParty(requestUrl, pageUrl) {
  if (!pageUrl || !/^https?:/i.test(pageUrl)) return false;
  const a = siteOf(requestUrl);
  const b = siteOf(pageUrl);
  return Boolean(a && b && a !== b);
}

function shouldUpgradeToHttps(url) {
  if (!ctx.settings.get('httpsOnly')) return false;
  if (!url.startsWith('http://')) return false;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (isLocalHost(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  const exceptions = ctx.settings.get('httpsExceptions') || [];
  return !exceptions.includes(host);
}

function setupNetwork(ses) {
  const wr = ses.webRequest;

  wr.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    try {
      const url = details.url;
      if (!/^(https?|wss?):/i.test(url)) return callback({});

      if (details.resourceType === 'mainFrame') {
        const tab = tabForWebContentsId(details.webContentsId);
        if (tab) tab.onMainFrameRequest(url);
        if (shouldUpgradeToHttps(url)) {
          const upgraded = `https://${url.slice('http://'.length)}`;
          if (tab) tab.httpsUpgrade = { from: url, to: upgraded };
          return callback({ redirectURL: upgraded });
        }
        return callback({});
      }

      const pageUrl = pageUrlFor(details);
      const result = ctx.adblock ? ctx.adblock.match(details, pageUrl) : null;
      if (result) {
        ctx.adblock.countBlocked();
        const tab = tabForWebContentsId(details.webContentsId);
        if (tab) tab.onRequestBlocked(url);
        return callback(result.cancel ? { cancel: true } : { redirectURL: result.redirectURL });
      }
      if (dataSaver.shouldBlock(ctx.settings, details, pageUrl)) {
        dataSaver.countBlocked(ses, details.resourceType);
        return callback({ cancel: true });
      }
      return callback({});
    } catch (err) {
      console.error('[network] onBeforeRequest', err);
      return callback({});
    }
  });

  wr.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    try {
      const headers = details.requestHeaders;
      if (!/^https?:/i.test(details.url)) return callback({ requestHeaders: headers });
      const saverPage = details.resourceType === 'mainFrame' ? details.url : pageUrlFor(details);
      if (dataSaver.activeFor(ctx.settings, saverPage)) headers['Save-Data'] = 'on';
      if (ctx.settings.get('doNotTrack')) headers.DNT = '1';
      if (ctx.settings.get('globalPrivacyControl')) headers['Sec-GPC'] = '1';
      if (ctx.settings.get('blockThirdPartyCookies') && details.resourceType !== 'mainFrame') {
        if (isThirdParty(details.url, pageUrlFor(details))) {
          for (const name of Object.keys(headers)) if (name.toLowerCase() === 'cookie') delete headers[name];
        }
      }
      return callback({ requestHeaders: headers });
    } catch (err) {
      console.error('[network] onBeforeSendHeaders', err);
      return callback({ requestHeaders: details.requestHeaders });
    }
  });

  wr.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    try {
      if (!/^https?:/i.test(details.url)) return callback({});
      let headers = null;
      const pageUrl = details.resourceType === 'mainFrame' ? details.url : pageUrlFor(details);
      if (ctx.adblock) headers = ctx.adblock.headers(details, pageUrl);
      if (
        ctx.settings.get('blockThirdPartyCookies') &&
        details.resourceType !== 'mainFrame' &&
        isThirdParty(details.url, pageUrl)
      ) {
        headers = headers || { ...(details.responseHeaders || {}) };
        for (const name of Object.keys(headers)) if (name.toLowerCase() === 'set-cookie') delete headers[name];
      }
      return callback(headers ? { responseHeaders: headers } : {});
    } catch (err) {
      console.error('[network] onHeadersReceived', err);
      return callback({});
    }
  });
}

module.exports = { setupNetwork, isThirdParty };
