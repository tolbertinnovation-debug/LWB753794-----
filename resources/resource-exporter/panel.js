'use strict';
const button = document.getElementById('export'), status = document.getElementById('status');
const encoder = new TextEncoder();
const MAX_ITEM = 10 * 1024 * 1024, MAX_TOTAL = 50 * 1024 * 1024;
let exporting = false;
function timeoutValue(start, fallback) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), 5000);
    start(value => { clearTimeout(timer); resolve(value); });
  });
}
button.addEventListener('click', async () => {
  if (exporting) return;
  exporting = true; button.disabled = true; status.textContent = 'Collecting loaded responses…';
  try {
    const har = await timeoutValue(done => chrome.devtools.network.getHAR(done), null);
    if (!har) throw new Error('Network data unavailable. Reload with Developer Tools open and try again.');
    const entries = har.entries || har.log?.entries || [], files = [], report = [];
    let total = 0;
    const html = await timeoutValue(done => chrome.devtools.inspectedWindow.eval('document.documentElement.outerHTML', (value, error) => done(error ? null : value)), null);
    if (typeof html === 'string') {
      const data = encoder.encode(html);
      if (data.length <= MAX_ITEM) { files.push({ name: 'page-snapshot.html', data }); total += data.length; }
    }
    for (const [index, entry] of entries.slice(0, 300).entries()) {
      const url = entry.request?.url || '', row = { url, status: entry.response?.status, mimeType: entry.response?.content?.mimeType };
      report.push(row);
      if (!/^https?:\/\//i.test(url)) { row.result = 'Unsupported URL'; continue; }
      if (entry.response?.content?.size > MAX_ITEM) { row.result = 'Resource exceeds size limit'; continue; }
      if (total >= MAX_TOTAL) { row.result = 'Archive size limit reached'; continue; }
      if (typeof entry.getContent !== 'function') { row.result = 'Response body unavailable'; continue; }
      const content = await timeoutValue(done => entry.getContent((text, encoding) => done({ text, encoding })), null);
      if (!content || typeof content.text !== 'string' || (!content.text && entry.response?.content?.size > 0)) { row.result = 'Response body unavailable'; continue; }
      let data;
      try { data = content.encoding === 'base64' ? Uint8Array.from(atob(content.text), char => char.charCodeAt(0)) : encoder.encode(content.text); }
      catch { row.result = 'Could not decode response'; continue; }
      if (data.length > MAX_ITEM || total + data.length > MAX_TOTAL) { row.result = 'Size limit reached'; continue; }
      const basename = new URL(url).pathname.split('/').pop() || 'resource';
      const name = `resources/${String(index + 1).padStart(3, '0')}-${basename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)}`;
      files.push({ name, data }); total += data.length; row.file = name; row.bytes = data.length; row.result = 'Exported';
      status.textContent = `Collected ${files.length} files…`;
    }
    files.push({ name: 'resource-report.json', data: encoder.encode(JSON.stringify({ capturedAt: new Date().toISOString(), totalRequests: entries.length, omittedBeyondLimit: Math.max(0, entries.length - 300), resources: report }, null, 2)) });
    const blob = resourceZip(files), link = document.createElement('a'), blobUrl = URL.createObjectURL(blob);
    link.href = blobUrl; link.download = `LIB-resources-${Date.now()}.zip`; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    status.textContent = `ZIP download requested: ${files.length} files. Check Downloads. The report lists unavailable or skipped responses. URLs in the report may contain private tokens.`;
  } catch (error) { status.textContent = error.message; }
  finally { exporting = false; button.disabled = false; }
});
