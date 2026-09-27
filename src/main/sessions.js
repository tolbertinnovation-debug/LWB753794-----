'use strict';

const { app, session } = require('electron');
const ctx = require('./context');
const { attachProtocol } = require('./protocol');
const { setupNetwork } = require('./network');

const MAIN_PARTITION = 'persist:lib';
const PRIVATE_PARTITION = 'lib-private'; // no "persist:" prefix → in-memory only

const configured = new WeakSet();

/**
 * A modern, clean Chrome user agent. Sites sniff for "Electron" and serve
 * degraded pages, so we present the same UA as the Chromium we embed.
 */
function buildUserAgent() {
  const major = process.versions.chrome.split('.')[0];
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function configure(ses, { isPrivate }) {
  if (configured.has(ses)) return ses;
  configured.add(ses);
  ses.setUserAgent(buildUserAgent(), app.getPreferredSystemLanguages().join(',') || 'en-US');
  attachProtocol(ses);
  setupNetwork(ses);
  ctx.permissions.attach(ses, { isPrivate });
  ctx.downloads.attach(ses, { isPrivate });
  ctx.adblock.attachSession(ses);
  try {
    ses.setSpellCheckerEnabled(Boolean(ctx.settings.get('spellcheck')));
    const available = new Set(ses.availableSpellCheckerLanguages || []);
    const wanted = app
      .getPreferredSystemLanguages()
      .flatMap((l) => [l, l.split('-')[0]])
      .filter((l) => available.has(l));
    if (wanted.length) ses.setSpellCheckerLanguages([...new Set(wanted)].slice(0, 3));
  } catch {
    /* spellchecker is best-effort (unsupported on some platforms) */
  }
  return ses;
}

function getBrowsingSession(isPrivate = false) {
  const ses = session.fromPartition(isPrivate ? PRIVATE_PARTITION : MAIN_PARTITION);
  return configure(ses, { isPrivate });
}

/** Wipe everything from the private session (called when the last private window closes). */
async function resetPrivateSession() {
  const ses = session.fromPartition(PRIVATE_PARTITION);
  try {
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    ses.clearHostResolverCache?.();
  } catch (err) {
    console.error('[sessions] failed to reset private session', err);
  }
  ctx.downloads.clearPrivate();
}

/** A cookieless session for fetching search suggestions. */
function getSuggestSession() {
  const ses = session.fromPartition('lib-suggest');
  if (!configured.has(ses)) {
    configured.add(ses);
    ses.setUserAgent(buildUserAgent());
  }
  return ses;
}

module.exports = { getBrowsingSession, resetPrivateSession, getSuggestSession, buildUserAgent, MAIN_PARTITION };
