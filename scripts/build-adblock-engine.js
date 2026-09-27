'use strict';

// Pre-builds the ad/tracker blocking engine (EasyList, EasyPrivacy, uBlock
// Origin lists) into resources/adblock-engine.bin so a fresh install blocks
// ads immediately, even offline. The browser refreshes the lists itself later.
//
// Usage: node scripts/build-adblock-engine.js   (run automatically by `npm run dist`)

const fs = require('node:fs');
const path = require('node:path');
const { FiltersEngine, adsAndTrackingLists } = require('@ghostery/adblocker');

const OUT = path.join(__dirname, '..', 'resources', 'adblock-engine.bin');

async function main() {
  const started = Date.now();
  const engine = await FiltersEngine.fromLists(fetch, adsAndTrackingLists, {
    enableCompression: true,
    loadCosmeticFilters: true,
    loadNetworkFilters: true,
    enableMutationObserver: true,
  });
  const bytes = engine.serialize();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bytes);
  console.log(`Ad-block engine: ${(bytes.length / 1024 / 1024).toFixed(1)} MB from ${adsAndTrackingLists.length} lists in ${((Date.now() - started) / 1000).toFixed(1)}s → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  // Never fail a release build over this: the browser downloads the lists on first run.
  console.warn(`Warning: could not pre-build the ad-block engine (${err.message}). The browser will download filter lists on first launch.`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
});
