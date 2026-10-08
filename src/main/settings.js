'use strict';

const { EventEmitter } = require('node:events');
const { JsonStore } = require('./store');

const ACCENTS = ['#bf0a30', '#002868', '#6d5dfc', '#0a84ff', '#12b886', '#f59f00', '#f03e3e', '#e64980', '#7950f2', '#15aabf'];

function defaults(downloadsPath) {
  return {
    // General
    startup: 'restore', // 'restore' | 'newtab' | 'homepage'
    homepage: 'lib://newtab',
    showHomeButton: false,
    showBookmarksBar: true,
    closeWindowWithLastTab: true,
    confirmQuitMultipleTabs: false,
    // Appearance
    theme: 'system', // 'system' | 'light' | 'dark'
    accentColor: ACCENTS[0],
    verticalTabs: false,
    compactMode: false,
    defaultZoom: 1,
    // Search
    searchEngine: 'google',
    customSearchUrl: '',
    searchSuggestions: false,
    // Privacy & security
    adblockEnabled: true,
    adblockAllowlist: [],
    httpsOnly: true,
    httpsExceptions: [],
    doNotTrack: true,
    globalPrivacyControl: true,
    blockThirdPartyCookies: true,
    clearOnExit: false,
    // Performance
    tabSleepEnabled: true,
    tabSleepMinutes: 30,
    // Downloads
    downloadDir: downloadsPath || '',
    askWhereToSave: false,
    // Languages
    spellcheck: true,
    // New tab page
    ntpShowClock: true,
    ntpShowTopSites: true,
    ntpShowStats: true,
    ntpShowGreeting: true,
    ntpBackground: 'liberia', // preset id or 'custom'
    ntpCustomBackground: '',
    ntpName: '',
    ntpQuickLinks: [],
    ntpHiddenSites: [],
    // Onboarding
    onboarded: false,
  };
}

/** Validators keep bad values (from sync files or buggy pages) out of the store. */
const VALIDATORS = {
  startup: (v) => ['restore', 'newtab', 'homepage'].includes(v),
  homepage: (v) => typeof v === 'string' && v.length < 4096,
  theme: (v) => ['system', 'light', 'dark'].includes(v),
  accentColor: (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v),
  defaultZoom: (v) => typeof v === 'number' && v >= 0.25 && v <= 5,
  searchEngine: (v) => typeof v === 'string' && v.length < 64,
  customSearchUrl: (v) => typeof v === 'string' && (v === '' || (/^https?:\/\//.test(v) && v.includes('%s'))),
  adblockAllowlist: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  httpsExceptions: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  tabSleepMinutes: (v) => typeof v === 'number' && v >= 1 && v <= 1440,
  downloadDir: (v) => typeof v === 'string',
  ntpBackground: (v) => typeof v === 'string' && v.length < 64,
  ntpCustomBackground: (v) => typeof v === 'string' && v.length < 2048,
  ntpName: (v) => typeof v === 'string' && v.length < 64,
  ntpQuickLinks: (v) =>
    Array.isArray(v) &&
    v.length <= 48 &&
    v.every((x) => x && typeof x.url === 'string' && typeof x.title === 'string'),
  ntpHiddenSites: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
};

class Settings extends EventEmitter {
  /**
   * @param {string} filePath
   * @param {string} downloadsPath default download directory
   */
  constructor(filePath, downloadsPath) {
    super();
    this.setMaxListeners(100);
    this._defaults = defaults(downloadsPath);
    this.store = new JsonStore(filePath, () => ({ ...this._defaults }), {
      migrate: (data) => ({ ...this._defaults, ...(data && typeof data === 'object' ? data : {}) }),
    });
  }

  get(key) {
    return this.store.data[key];
  }

  all() {
    return { ...this.store.data };
  }

  /**
   * Set a value. Unknown keys and invalid values are rejected.
   * @returns {boolean} whether the value was stored
   */
  set(key, value) {
    if (typeof key !== 'string' || !Object.hasOwn(this._defaults, key)) return false;
    const def = this._defaults[key];
    const validate = VALIDATORS[key] || ((v) => typeof v === typeof def);
    if (!validate(value)) return false;
    const prev = this.store.data[key];
    if (JSON.stringify(prev) === JSON.stringify(value)) return true;
    this.store.data[key] = value;
    this.store.save();
    this.emit('change', key, value, prev);
    return true;
  }

  reset() {
    const prevOnboarded = this.store.data.onboarded;
    for (const key of Object.keys(this._defaults)) {
      if (key === 'onboarded') continue;
      this.set(key, this._defaults[key]);
    }
    this.store.data.onboarded = prevOnboarded;
    this.store.save();
  }

  flush() {
    this.store.flush();
  }
}

module.exports = { Settings, ACCENTS, defaults };
