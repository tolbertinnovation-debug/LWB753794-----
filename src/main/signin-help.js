'use strict';

function rejectedGoogleSignin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'accounts.google.com' && !url.username && !url.password && !url.port && /^\/v\d+\/signin\/rejected\/?$/.test(url.pathname);
  } catch { return false; }
}

function signinWebsite(value) {
  if (!rejectedGoogleSignin(value)) return null;
  try {
    const domain = new URL(value).searchParams.get('app_domain');
    const site = new URL(domain);
    if (site.protocol !== 'https:' || site.username || site.password || site.port || !site.hostname.includes('.')) return null;
    // Start a fresh sign-in on the website; never transfer OAuth parameters.
    return site.origin + '/';
  } catch { return null; }
}

async function help(win, tab) {
  if (!win) return;
  const { dialog, shell } = require('electron');
  const website = signinWebsite(tab?.state.url);
  const { response } = await dialog.showMessageBox(win.win, {
    type: 'info', title: 'Google sign-in help', message: 'Google may reject sign-in in embedded browsers.',
    detail: `Open the website in your default browser and start “Sign in with Google” there. Your login will stay in that browser and will not sign you into LIB Browser. You can also use the website’s email/password login if available.${website ? `\n\nWebsite: ${website}` : '\n\nReturn to the website and copy its address into Chrome, Edge, or Firefox.'}`,
    buttons: website ? ['Close', 'Open website in default browser'] : ['Close'], defaultId: 0, cancelId: 0,
  });
  if (website && response === 1) {
    try { await shell.openExternal(website); }
    catch { win.sendChrome('toast', { message: 'Could not open the default browser. Copy the website address into Chrome or Edge.' }); }
  }
}

module.exports = { rejectedGoogleSignin, signinWebsite, help };
