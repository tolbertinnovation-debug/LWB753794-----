'use strict';

// Renders build/icon.svg into the PNG sizes needed by electron-builder.
// Run with Electron: `npm run build:icons` (uses offscreen rendering).

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const BUILD = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  const html = `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((r) => setTimeout(r, 400));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const dir = path.join(BUILD, 'icons');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(BUILD, 'icon.png'), image.toPNG());
  for (const size of SIZES) {
    const resized = size === 1024 ? image : image.resize({ width: size, height: size, quality: 'best' });
    fs.writeFileSync(path.join(dir, `${size}x${size}.png`), resized.toPNG());
  }
  console.log(`Wrote build/icon.png and ${SIZES.length} sizes to build/icons/`);
  app.quit();
});
