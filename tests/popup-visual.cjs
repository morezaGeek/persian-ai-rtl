// Isolated browser test: all resources and Chrome APIs are local fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'ai-rtl');
const output = path.join(root, 'test-results');
const origin = 'https://ai-rtl-popup.test';
const files = new Map([
  ['/popup.html', ['popup.html', 'text/html; charset=utf-8']],
  ['/popup.css', ['popup.css', 'text/css']],
  ['/popup.js', ['popup.js', 'application/javascript']],
  ['/hosts.js', ['hosts.js', 'application/javascript']],
  ['/fonts/Vazirmatn-Variable.woff2', ['fonts/Vazirmatn-Variable.woff2', 'font/woff2']]
]);
let browser;

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 320, height: 600 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const file = url.origin === origin && files.get(url.pathname);
    if (file) await route.fulfill({ contentType: file[1], body: fs.readFileSync(path.join(extension, file[0])) });
    else await route.abort();
  });
  await page.addInitScript(() => {
    const tabHost = new URL(location.href).searchParams.get('site') || 'gemini.google.com';
    const storageKey = 'popup-test-settings';
    const initial = { fontSizes: { 'gemini.google.com': 80, 'antigravity.google.com': 120 } };
    window.__writes = [];
    window.chrome = {
      runtime: {},
      tabs: { query(options, callback) { callback([{ url: `https://${tabHost}/conversation` }]); } },
      storage: { sync: {
        get(defaults, callback) { callback({ ...defaults, ...JSON.parse(localStorage.getItem(storageKey) || JSON.stringify(initial)) }); },
        set(patch, callback) {
          const stored = JSON.parse(localStorage.getItem(storageKey) || JSON.stringify(initial));
          localStorage.setItem(storageKey, JSON.stringify({ ...stored, ...patch }));
          window.__writes.push(patch);
          callback();
        }
      } }
    };
  });
  fs.mkdirSync(output, { recursive: true });
  async function open(hostname, colorScheme, filename) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`${origin}/popup.html?site=${hostname}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => !document.getElementById('fontSize').disabled);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const id of ['fontSize', 'resetFontSize', 'toggleSite', 'enabled', 'persianFont', 'englishFont', 'allSites']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      const box = await page.locator(`#${id}`).evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.x, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      assert.ok(box.x >= 0 && box.right <= 320 && box.top >= 0 && box.bottom <= 600, `${id} fits popup`);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    if (filename) await page.locator('body').screenshot({ path: path.join(output, filename) });
  }

  await open('gemini.google.com', 'light', 'popup-gemini-80.png');
  for (const id of ['persianFont', 'englishFont']) {
    assert.equal(await page.locator(`label[for="${id}"]`).count(), 1, 'native font select has a visible label');
    assert.equal(await page.locator(`#${id}`).getAttribute('aria-describedby'), 'fontsHint');
  }
  await page.locator('#persianFont').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#persianFont').inputValue(), 'tahoma');
  await page.locator('#englishFont').selectOption('georgia');
  await page.reload();
  assert.equal(await page.locator('#persianFont').inputValue(), 'tahoma');
  assert.equal(await page.locator('#englishFont').inputValue(), 'georgia');
  await page.evaluate(() => { window.__writes = []; });
  assert.equal(await page.locator('#fontSizeValue').textContent(), '80%');
  await page.locator('#fontSize').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#fontSizeValue').textContent(), '85%');
  assert.equal(await page.evaluate(() => window.__writes.length), 1);
  await page.reload();
  assert.equal(await page.locator('#fontSizeValue').textContent(), '85%');

  await open('antigravity.google.com', 'dark', 'popup-antigravity-120.png');
  assert.equal(await page.locator('#fontSizeValue').textContent(), '120%');
  assert.match(await page.locator('#status').textContent(), /✓/);
  await page.locator('#fontSize').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#fontSizeValue').textContent(), '125%');
  await open('gemini.google.com', 'light');
  assert.equal(await page.locator('#fontSizeValue').textContent(), '85%');
  await page.locator('#resetFontSize').click();
  assert.equal(await page.locator('#fontSizeValue').textContent(), '100%');
  await page.reload();
  assert.equal(await page.locator('#fontSizeValue').textContent(), '100%');
  assert.equal(await page.locator('#resetFontSize').isDisabled(), true);
  await open('antigravity.google.com', 'dark');
  assert.equal(await page.locator('#fontSizeValue').textContent(), '125%');
  assert.deepEqual(errors, []);
  console.log('PASS popup light/dark layout, labeled keyboard font selectors, font/size persistence, host isolation, and reset');
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
