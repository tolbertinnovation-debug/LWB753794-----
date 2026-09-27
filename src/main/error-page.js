'use strict';

/**
 * Friendly network error pages. When a main-frame load fails, Chromium
 * commits a blank error document at the failed URL; we inject this markup
 * into it. Keeping the failed URL committed means Back/Forward/Reload all
 * behave exactly like in Chrome.
 *
 * Buttons navigate to lib://net-error/<action>, which the tab intercepts in
 * `will-navigate` (and only honours while it is showing an error).
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isCertError(code) {
  return code <= -200 && code > -300;
}

function describe(code, host, errorName) {
  if (isCertError(code)) {
    return {
      kind: 'danger',
      icon: 'shield',
      title: 'Your connection is not private',
      body: `Attackers might be trying to steal your information from <b>${esc(host)}</b> (for example, passwords, messages, or credit cards).`,
    };
  }
  switch (code) {
    case -105:
    case -137:
      return {
        icon: 'globe',
        title: "This site can't be reached",
        body: `<b>${esc(host)}</b>'s server IP address could not be found.`,
        tips: ['Check the address for a typo', 'Check your internet connection', 'Check your DNS or proxy settings'],
      };
    case -106:
      return {
        icon: 'wifi',
        title: "You're offline",
        body: 'LIB can’t connect to the internet right now.',
        tips: ['Check network cables, modem, and router', 'Reconnect to Wi‑Fi', 'Try turning airplane mode off'],
      };
    case -102:
      return { icon: 'plug', title: "This site can't be reached", body: `<b>${esc(host)}</b> refused to connect.`, tips: ['Check the address', 'The server may be down — try again later'] };
    case -7:
    case -118:
      return { icon: 'clock', title: "This site can't be reached", body: `<b>${esc(host)}</b> took too long to respond.`, tips: ['Check your connection', 'Try again in a moment'] };
    case -100:
    case -101:
    case -21:
      return { icon: 'plug', title: "This site can't be reached", body: 'The connection was interrupted.', tips: ['Check your connection', 'Try again'] };
    case -109:
      return { icon: 'globe', title: "This site can't be reached", body: `<b>${esc(host)}</b> is unreachable.` };
    case -107:
    case -113:
    case -123:
      return { kind: 'danger', icon: 'shield', title: "This site can't provide a secure connection", body: `<b>${esc(host)}</b> sent an invalid response.` };
    case -310:
      return { icon: 'repeat', title: "This page isn't working", body: `<b>${esc(host)}</b> redirected you too many times.`, tips: ['Try clearing cookies for this site'] };
    case -324:
      return { icon: 'file', title: "This page isn't working", body: `<b>${esc(host)}</b> didn't send any data.` };
    case -312:
      return { icon: 'lock', title: 'This address is restricted', body: 'This port is commonly used for services other than web browsing, so LIB blocks it.' };
    case -6:
      return { icon: 'file', title: 'File not found', body: 'It may have been moved, edited, or deleted.' };
    case -20:
      return { icon: 'shield', title: 'This page has been blocked', body: 'A content filter blocked this page.' };
    case -300:
    case -301:
    case -302:
      return { icon: 'file', title: "This address can't be opened", body: 'The address is invalid or uses an unsupported protocol.' };
    default:
      return { icon: 'file', title: "This page isn't working", body: `<b>${esc(host)}</b> couldn't load this page.` };
  }
}

const ICONS = {
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M12 20h.01"/><path d="M2 2l20 20"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4M12 16h.01"/>',
  repeat: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9.5 12.5l5 5M14.5 12.5l-5 5"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

/**
 * @param {{ code: number, description: string, url: string, httpsOnlyFallback?: string }} info
 * @returns {{ title: string, html: string }}
 */
function buildErrorPage(info) {
  let host = '';
  try {
    host = new URL(info.url).host;
  } catch {
    host = info.url;
  }
  let d = describe(info.code, host, info.description);
  const actions = [];
  if (info.httpsOnlyFallback) {
    d = {
      kind: 'warn',
      icon: 'lock',
      title: 'Secure site not available',
      body: `<b>${esc(host)}</b> doesn't support a secure connection with HTTPS. HTTPS‑Only Mode is on, so LIB didn't load the insecure version.`,
    };
    actions.push(`<a class="btn primary" href="lib://net-error/back">Go back</a>`);
    actions.push(`<a class="btn" href="lib://net-error/continue-http">Continue to HTTP site</a>`);
  } else {
    actions.push(`<a class="btn primary" href="lib://net-error/retry">Try again</a>`);
  }
  let advanced = '';
  if (isCertError(info.code)) {
    actions.length = 0;
    actions.push(`<a class="btn primary" href="lib://net-error/back">Back to safety</a>`);
    advanced = `<details><summary>Advanced</summary><p>This server could not prove that it is <b>${esc(host)}</b>; its security certificate is not trusted (${esc(info.description)}). This may be caused by a misconfiguration or an attacker intercepting your connection.</p><p><a class="danger-link" href="lib://net-error/proceed">Proceed to ${esc(host)} (unsafe)</a></p></details>`;
  }
  const tips = d.tips ? `<ul>${d.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  const accent = d.kind === 'danger' ? '#e5484d' : d.kind === 'warn' ? '#f5a524' : '#6d5dfc';
  const title = d.title;
  const html = `<head><meta charset="utf-8"><title>${esc(host || title)}</title><meta name="color-scheme" content="light dark"><style>
:root{--bg:#f6f7fb;--fg:#1d1f27;--muted:#5d6272;--card:#fff;--line:#e6e8ef;--accent:${accent}}
:root.dark{--bg:#15161c;--fg:#eceef4;--muted:#a1a6b6;--card:#1d1f27;--line:#2c2f3a;color-scheme:dark}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif;display:flex;align-items:center;justify-content:center;padding:32px}
main{max-width:600px;width:100%;animation:in .35s ease-out}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.icon{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);margin-bottom:22px}
.icon svg{width:34px;height:34px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
h1{font-size:26px;line-height:1.25;margin:0 0 10px;font-weight:650;letter-spacing:-.01em}
p{margin:0 0 12px;color:var(--muted)}p b{color:var(--fg);font-weight:600;word-break:break-all}
ul{margin:4px 0 18px;padding-left:20px;color:var(--muted)}li{margin:3px 0}
.code{font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--muted);opacity:.8;margin:18px 0 26px;text-transform:uppercase;letter-spacing:.04em}
.actions{display:flex;gap:10px;flex-wrap:wrap}
.btn{appearance:none;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:9px 18px;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px;transition:transform .1s,filter .15s}
.btn:hover{filter:brightness(.97)}.btn:active{transform:scale(.98)}
.btn.primary{background:var(--accent);border-color:transparent;color:#fff}
details{margin-top:24px;color:var(--muted)}summary{cursor:pointer;font-weight:600;color:var(--fg)}
.danger-link{color:#e5484d;font-weight:600}
</style></head><body><main>
<div class="icon"><svg viewBox="0 0 24 24">${ICONS[d.icon] || ICONS.file}</svg></div>
<h1>${esc(title)}</h1><p>${d.body}</p>${tips}
<div class="code">${esc(info.description || '')}${info.code ? ` (${info.code})` : ''}</div>
<div class="actions">${actions.join('')}</div>${advanced}
</main></body>`;
  return { title, html };
}

/** JavaScript that replaces the committed error document with our page. */
function injectionScript(info, dark = false) {
  const { html } = buildErrorPage(info);
  return `(() => { document.documentElement.innerHTML = ${JSON.stringify(html)}; document.documentElement.classList.toggle('dark', ${Boolean(dark)}); })();`;
}

module.exports = { buildErrorPage, injectionScript, isCertError };
