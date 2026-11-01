// Regressions based on the two actual Antigravity list structures in the report.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'ai-rtl');
const origin = 'https://antigravity.static.usercontent.goog';
const fixture = `<!doctype html><meta charset="utf-8"><title>Antigravity prose lists with embedded widgets</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#101010;color:#ddd;font:20px/1.7 Arial,sans-serif}
main{max-width:1200px;margin:auto;padding:28px}h3{text-align:right;font-size:24px}
ul,ol{padding-left:36px;padding-right:0}li{margin:14px 0}p{margin:10px 0;text-align:left}
.response{display:flex;flex-direction:column;gap:8px}pre{font:14px/1.6 monospace;text-align:left;margin:14px 0;white-space:pre-wrap}
.code-box{border:1px solid #333;border-radius:18px;overflow:hidden}.toolbar{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;padding:6px 12px;font:14px Arial}
.actions{display:flex;gap:12px}button{background:none;color:#aaa;border:0;font:14px Arial}.code-body{padding:16px;font:14px monospace}
.katex-display{display:block;text-align:center;padding:15px}.katex{font:22px 'Times New Roman'}
.markdown-alert{border-left:4px solid #9c6eff;padding-left:20px}.markdown-alert-title{display:flex;gap:8px;color:#9c6eff}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}table{width:100%}td{width:50%}
</style><main>
<div role="article" aria-label="Agent response" id="reply"><div class="response">
<h3>چطور مایلید اقدام کنیم؟</h3>
<ul id="code-list" style="direction:ltr!important"><li id="first-item"><strong>حالت اول:</strong> متن فارسی همراه کادر کد و دکمه‌های آن.
<pre id="code-pre"><div class="code-box"><div class="toolbar" id="toolbar"><div id="language">bash</div><div class="actions" id="actions"><button id="mention">@</button><button id="copy">Copy</button></div></div><div class="code-body" id="code-body">printf 'example'</div></div></pre>
</li><li id="second-item"><strong>حالت دوم:</strong> ادامهٔ فارسی که باید از سمت راست خوانده شود.</li></ul>
<h3>کارهای مورد نظر:</h3>
<ol id="complex-list"><li id="math-item"><strong>تنظیم زمان:</strong><br>ارسال بسته‌ها هر سی ثانیه:
<span style="display:block;text-align:center"><span class="katex-display"><span class="katex" id="formula">30 sec × 20,160 = 7 days</span></span></span>متن فارسی پس از فرمول.</li>
<li id="note-item"><strong>تغییر تنظیمات:</strong><br>متن فارسی با <code id="inline-code">AUTH_SECONDS</code> و <code>DETACH_SECONDS</code>.
<div class="markdown-alert" dir="auto"><p class="markdown-alert-title" dir="auto" id="alert-title"><span id="note-icon">!</span><span id="note-label">IMPORTANT</span></p><p>نکتهٔ مهم: این متن فارسی باید راست‌چین بماند.</p></div></li>
<li id="layout-item"><p>جدول و چیدمان داخلی:</p><div class="grid" id="grid"><div id="grid-first">First</div><div id="grid-second">Second</div></div>
<table id="table"><tr><td id="col-first">ستون اول</td><td id="col-second">ستون دوم</td></tr></table></li></ol>
</div></div>
<nav><ul id="navigation"><li>بخش رابط <button>عملیات</button></li></ul></nav>
</main>`;
let browser;
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < .1, `${label}: ${actual} != ${expected}`);
(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url() === `${origin}/`) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture });
    if (route.request().url().endsWith('.woff2')) return route.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(path.join(extension, 'fonts/Vazirmatn-Variable.woff2')) });
    return route.abort();
  });
  await page.goto(origin);
  const snapshot = () => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('[id]')).filter(el => !el.id.startsWith('vzx')).map(el => {
    const style = getComputedStyle(el), rect = el.getBoundingClientRect();
    return [el.id, { direction: style.direction, font: style.fontFamily, size: parseFloat(style.fontSize), align: style.textAlign,
      x: rect.x, width: rect.width, inline: el.getAttribute('style'), dir: el.getAttribute('dir') }];
  })));
  const before = await snapshot();
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results', 'antigravity-lists-before.png'), fullPage: true });
  await page.evaluate(origin => {
    const listeners = [];
    window.chrome = { runtime: { getURL: resource => `${origin}/${resource}` }, storage: {
      sync: { get: (defaults, callback) => callback({ ...defaults, fontSizes: { 'antigravity.google.com': 120 } }) },
      onChanged: { addListener: listener => listeners.push(listener) }
    } };
    window.patchSettings = patch => listeners.forEach(listener => listener(Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { newValue }])), 'sync'));
  }, origin);
  await page.addScriptTag({ path: path.join(extension, 'hosts.js') });
  await page.addScriptTag({ path: path.join(extension, 'content.js') });
  await page.evaluate(async () => { await new Promise(requestAnimationFrame); await document.fonts.ready; });
  const active = await snapshot();
  for (const id of ['code-list', 'complex-list', 'first-item', 'second-item', 'math-item', 'note-item']) {
    assert.equal(active[id].direction, 'rtl', id);
  }
  for (const id of ['first-item', 'second-item', 'math-item', 'note-item']) {
    assert.ok(active[id].font.includes('VzxFa'), `${id} font`);
    near(active[id].size, before[id].size * 1.2, `${id} size`);
    assert.equal(active[id].align, 'start', `${id} alignment`);
  }
  assert.equal(active.navigation.direction, before.navigation.direction, 'navigation stays untouched');
  for (const id of ['toolbar', 'actions', 'grid', 'table', 'alert-title']) assert.equal(active[id].direction, before[id].direction, `${id} layout direction`);
  assert.ok(active.language.x < active.actions.x, 'language label stays before code buttons');
  assert.ok(active['note-icon'].x < active['note-label'].x, 'callout heading order is preserved');
  assert.ok(active['grid-first'].x < active['grid-second'].x, 'grid order is preserved');
  assert.ok(active['col-first'].x < active['col-second'].x, 'table column order is preserved');
  for (const id of ['code-pre', 'code-body', 'formula', 'inline-code', 'copy']) assert.equal(active[id].font, before[id].font, `${id} original font`);
  assert.equal(active['code-pre'].direction, 'ltr');
  assert.equal(active.formula.direction, 'ltr');
  console.log('PASS real role=article lists with code, display math and callouts use RTL and per-site text size');
  console.log('PASS nested code controls, math, grid and table keep their original fonts and order');
  await page.screenshot({ path: path.join(root, 'test-results', 'antigravity-lists-after.png'), fullPage: true });
  const streamed = await page.evaluate(async () => {
    document.getElementById('second-item').innerHTML = 'پاسخ فارسی تازه <div class="toolbar" id="new-toolbar"><span id="new-first">Left</span><button id="new-second">Right</button></div>';
    await new Promise(requestAnimationFrame);
    const toolbar = document.getElementById('new-toolbar');
    return { direction: getComputedStyle(toolbar).direction, first: document.getElementById('new-first').getBoundingClientRect().x,
      second: document.getElementById('new-second').getBoundingClientRect().x, item: getComputedStyle(toolbar.parentElement).direction };
  });
  assert.equal(streamed.direction, 'ltr', 'new widget does not inherit our existing RTL list direction');
  assert.equal(streamed.item, 'rtl');
  assert.ok(streamed.first < streamed.second);
  console.log('PASS streamed widgets preserve the website direction at the first frame, including inline-important list direction');
  await page.evaluate(async () => { document.getElementById('new-toolbar').dir = 'rtl'; await new Promise(requestAnimationFrame); });
  assert.equal(await page.locator('#new-toolbar').evaluate(el => getComputedStyle(el).direction), 'rtl');
  await page.evaluate(async () => { document.getElementById('new-toolbar').removeAttribute('dir'); await new Promise(requestAnimationFrame); });
  assert.equal(await page.locator('#new-toolbar').evaluate(el => getComputedStyle(el).direction), 'ltr');
  console.log('PASS preserved widgets follow later site-owned direction changes');
  await page.evaluate(async () => { document.getElementById('new-toolbar').className = ''; await new Promise(requestAnimationFrame); });
  assert.equal(await page.locator('#new-toolbar').getAttribute('data-vzx-layout-direction'), null);
  console.log('PASS changing a widget back into ordinary text releases its layout override');
  await page.evaluate(async () => { patchSettings({ enabled: false }); await new Promise(requestAnimationFrame); });
  const restored = await snapshot();
  for (const id of Object.keys(before).filter(id => id !== 'second-item')) {
    for (const key of ['direction', 'font', 'size', 'align', 'dir']) assert.equal(restored[id][key], before[id][key], `${id} restored ${key}`);
    for (const name of ['direction', '--vzx-fb', '--vzx-protected-font', '--vzx-size']) {
      const originals = await page.locator(`#${id}`).evaluate((el, name) => [el.style.getPropertyValue(name), el.style.getPropertyPriority(name)], name);
      if (id === 'code-list' && name === 'direction') assert.deepEqual(originals, ['ltr', 'important']);
      else assert.deepEqual(originals, ['', ''], `${id}.${name} restored`);
    }
  }
  assert.equal(await page.locator('[data-vzx-layout-direction], [data-vzx-item], [data-vzx-list], [data-vzx-f], [data-vzx-protected-font], :root[data-vzx-measure-direction]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS disable restores original list/widget directions and fonts with no layout markers left behind');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); });
