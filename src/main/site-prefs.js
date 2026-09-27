'use strict';

const { JsonStore } = require('./store');

/**
 * Per-site preferences: remembered zoom levels and permission decisions.
 */
class SitePrefs {
  constructor(filePath) {
    this.store = new JsonStore(filePath, () => ({ zoom: {}, permissions: {} }), {
      migrate: (d) => ({
        zoom: d?.zoom && typeof d.zoom === 'object' ? d.zoom : {},
        permissions: d?.permissions && typeof d.permissions === 'object' ? d.permissions : {},
      }),
    });
  }

  getZoom(host) {
    if (!host) return null;
    const z = this.store.data.zoom[host];
    return typeof z === 'number' ? z : null;
  }

  setZoom(host, factor, defaultZoom = 1) {
    if (!host) return;
    if (Math.abs(factor - defaultZoom) < 0.001) delete this.store.data.zoom[host];
    else this.store.data.zoom[host] = Math.round(factor * 100) / 100;
    this.store.save();
  }

  getPermission(origin, permission) {
    return this.store.data.permissions[origin]?.[permission] || null;
  }

  setPermission(origin, permission, decision) {
    if (!origin) return;
    const entry = this.store.data.permissions[origin] || {};
    if (decision === null) delete entry[permission];
    else entry[permission] = decision;
    if (Object.keys(entry).length) this.store.data.permissions[origin] = entry;
    else delete this.store.data.permissions[origin];
    this.store.save();
  }

  listPermissions() {
    return Object.entries(this.store.data.permissions).map(([origin, perms]) => ({ origin, perms: { ...perms } }));
  }

  clearOrigin(origin) {
    delete this.store.data.permissions[origin];
    this.store.save();
  }

  clearAll() {
    this.store.data.zoom = {};
    this.store.data.permissions = {};
    this.store.save();
  }

  flush() {
    this.store.flush();
  }
}

module.exports = { SitePrefs };
