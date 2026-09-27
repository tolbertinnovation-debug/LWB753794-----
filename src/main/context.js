'use strict';

/**
 * Process-wide registry of long-lived services. Populated once in index.js;
 * other modules read from it lazily to avoid circular requires.
 *
 * @type {{
 *   settings: import('./settings').Settings,
 *   history: import('./history').History,
 *   bookmarks: import('./bookmarks').Bookmarks,
 *   downloads: import('./downloads').DownloadManager,
 *   permissions: import('./permissions').PermissionManager,
 *   sitePrefs: import('./site-prefs').SitePrefs,
 *   adblock: import('./adblock').AdBlocker,
 *   sessionState: import('./session-state').SessionState,
 *   userDataPath: string,
 *   isTest: boolean,
 *   quitting: boolean,
 * }}
 */
const ctx = {
  settings: null,
  history: null,
  bookmarks: null,
  downloads: null,
  permissions: null,
  sitePrefs: null,
  adblock: null,
  sessionState: null,
  userDataPath: '',
  isTest: false,
  quitting: false,
};

module.exports = ctx;
