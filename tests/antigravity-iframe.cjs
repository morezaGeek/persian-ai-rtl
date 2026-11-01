// Reproduce Antigravity's real cross-origin chat architecture, entirely offline.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const extension = path.resolve(__dirname, '..', 'ai-rtl');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
const outer = 'https://antigravity.google.com';
const inner = 'https://antigravity.static.usercontent.goog';
const innerPattern = `${inner}/*`;
const registration = manifest.content_scripts.filter(entry => entry.matches.includes(innerPattern));
assert.equal(registration.length, 1, 'one explicit registration for the observed chat origin');
assert.equal(registration[0].all_frames, true, 'the real chat lives in an iframe');
assert.ok(manifest.content_scripts.find(entry => entry.matches.includes('<all_urls>'))
  .exclude_matches.includes(innerPattern), 'avoid duplicate injection on a direct frame-origin tab');
assert.equal(manifest.content_scripts.find(entry => entry.matches.includes('<all_urls>')).all_frames, undefined,
  'other sites retain their existing top-frame-only behavior');
let browser;
(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const content = '<!doctype html><style>body{font:20px/1.6 Arial}#layout{display:flex}aside{width:150px}main{flex:1}table{width:100%}code{font-family:monospace}</style>' +
    '<div id="layout"><aside>Sidebar</aside><main><p id="response">متن فارسی در گفت‌وگوی آنتی‌گرویتی</p>' +
    '<table><tr><td id="first">ستون اول</td><td id="second">ستون دوم</td></tr></table>' +
    '<pre><code id="code">const message = "سلام";</code></pre></main></div>';
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === `${outer}/`) await route.fulfill({ contentType: 'text/html',
      body: `<iframe title="Antigravity Remote Control" style="width:100%;height:800px" src="${inner}/web/cli-1.4.5/"></iframe>` });
    else if (url === `${inner}/web/cli-1.4.5/`) await route.fulfill({ contentType: 'text/html; charset=utf-8', body: content });
    else if (url.endsWith('/fonts/Vazirmatn-Variable.woff2')) await route.fulfill({ contentType: 'font/woff2',
      body: fs.readFileSync(path.join(extension, 'fonts/Vazirmatn-Variable.woff2')) });
    else await route.abort();
  });
  await page.goto(outer);
  const frame = page.frames().find(frame => frame.url().startsWith(inner));
  assert.ok(frame, 'cross-origin frame loaded');
  const baseline = await frame.evaluate(() => ({
    code: getComputedStyle(document.getElementById('code')).fontFamily,
    left: document.getElementById('first').getBoundingClientRect().x,
    right: document.getElementById('second').getBoundingClientRect().x
  }));
  // Browser registration is checked above. Inject the registered files into the
  // local frame with a mocked storage API; no real chat or account is touched.
  await frame.evaluate(inner => {
    const listeners = [];
    const state = { fontSizes: { 'antigravity.google.com': 120, 'gemini.google.com': 80 } };
    window.chrome = { runtime: { getURL: resource => `${inner}/${resource}`,
      onMessage: { addListener: listener => { window.deliverPreview = listener; } } }, storage: {
      sync: { get: (defaults, callback) => callback({ ...defaults, ...state }) },
      onChanged: { addListener: listener => listeners.push(listener) }
    } };
    window.patchSettings = patch => listeners.forEach(listener => listener(
      Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { newValue }])), 'sync'));
  }, inner);
  for (const file of registration[0].js) await frame.addScriptTag({ path: path.join(extension, file) });
  const inspect = () => frame.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await document.fonts.ready;
    const el = document.getElementById('response'), style = getComputedStyle(el);
    return { direction: style.direction, font: style.fontFamily, size: parseFloat(style.fontSize),
      code: getComputedStyle(document.getElementById('code')).fontFamily,
      left: document.getElementById('first').getBoundingClientRect().x,
      right: document.getElementById('second').getBoundingClientRect().x };
  });
  const active = await inspect();
  assert.equal(active.direction, 'rtl');
  assert.ok(active.font.includes('VzxFa'));
  assert.equal(active.size, 24, 'outer site 120% applies inside the different-origin frame');
  assert.equal(active.code, baseline.code);
  assert.ok(active.left < active.right, 'table columns keep their order');
  await frame.evaluate(() => deliverPreview({ type: 'vzx-font-scale-preview', host: 'antigravity.google.com', value: 165 }));
  assert.equal((await inspect()).size, 33, '165% preview applies immediately inside the remote iframe');
  await frame.evaluate(() => deliverPreview({ type: 'vzx-font-scale-preview', host: 'gemini.google.com', value: 80 }));
  assert.equal((await inspect()).size, 33, 'unrelated hosts cannot change this iframe');
  await frame.evaluate(() => deliverPreview({ type: 'vzx-font-scale-preview', host: 'antigravity.google.com', value: 100 }));
  assert.equal((await inspect()).size, 20, 'reset preview applies immediately');
  await frame.evaluate(() => patchSettings({ disabledHosts: ['antigravity.google.com'] }));
  assert.equal((await inspect()).size, 20);
  assert.equal(await frame.locator('[data-vzx-f], [data-vzx-d], #vzx-style').count(), 0);
  await frame.evaluate(() => patchSettings({ disabledHosts: [], fontSizes: { 'antigravity.google.com': 130 } }));
  assert.equal((await inspect()).size, 26);
  await frame.evaluate(() => { document.getElementById('response').outerHTML = '<p id="response">پاسخ جایگزین فارسی</p>'; });
  const fresh = await inspect();
  assert.equal(fresh.size, 26);
  assert.equal(fresh.direction, 'rtl');
  assert.deepEqual(errors, []);
  console.log('PASS observed Antigravity iframe origin, scoped manifest registration, outer-host size/toggles, table/code preservation, and streamed replacement');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); });
