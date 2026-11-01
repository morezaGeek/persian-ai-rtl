// Run with Node.js and Playwright available (NODE_PATH may point to the bundled runtime).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'ai-rtl');
const fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
const results = [];
let browser;
const pause = (page) => page.waitForTimeout(180);
async function check(name, callback) {
  await callback();
  results.push(name);
  console.log(`PASS ${name}`);
}

(async () => {
  const origin = 'https://ai-rtl.test';
  const options = { headless: true };
  if (process.env.CHROME_PATH) options.executablePath = process.env.CHROME_PATH;
  browser = await chromium.launch(options);
  const page = await browser.newPage({ viewport: { width: 1300, height: 1100 } });
  // Fulfill every request locally: no internet, login, or live site is used by these tests.
  await page.route('**/*', async (route) => {
    if (route.request().url() === `${origin}/fonts/Vazirmatn-Variable.woff2`) {
      await route.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(path.join(extension, 'fonts', 'Vazirmatn-Variable.woff2')) });
    } else if (route.request().url() === `${origin}/`) {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture });
    } else await route.abort();
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  const snapshot = () => page.evaluate(() => {
    const ids = ['app', 'toolbar', 'main', 'sidebar', 'avatar', 'composer', 'send', 'table', 'col1', 'col2', 'grid', 'grid1', 'grid2', 'mixed', 'english', 'inline-code', 'code-block', 'formula', 'math', 'inline-icon', 'nav-button', 'steps'];
    return Object.fromEntries(ids.map((id) => {
      const el = document.getElementById(id);
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return [id, { x: rect.x, width: rect.width, direction: style.direction, align: style.textAlign, font: style.fontFamily, dir: el.getAttribute('dir'), textAlign: el.style.getPropertyValue('text-align'), textAlignPriority: el.style.getPropertyPriority('text-align'), fallback: el.style.getPropertyValue('--vzx-fb'), fallbackPriority: el.style.getPropertyPriority('--vzx-fb') }];
    }));
  });
  const before = await snapshot();
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results', 'before.png'), fullPage: true });
  await page.evaluate((origin) => {
    const listeners = [];
    const state = { enabled: true, allSites: true };
    window.chrome = {
      runtime: { getURL: (resource) => `${origin}/${resource}` },
      storage: {
        sync: { get: (defaults, callback) => callback({ ...defaults, ...state }) },
        onChanged: { addListener: (listener) => listeners.push(listener) }
      }
    };
    window.patchSettings = (patch) => {
      const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: state[key], newValue: value }]));
      Object.assign(state, patch);
      listeners.forEach((listener) => listener(changes, 'sync'));
    };
  }, origin);
  await page.addScriptTag({ path: path.join(extension, 'hosts.js') });
  await page.addScriptTag({ path: path.join(extension, 'content.js') });
  await pause(page);
  await page.evaluate(() => document.fonts.ready);
  const after = await snapshot();

  await check('mixed Persian/English text uses RTL even when it starts with an English name', async () => {
    assert.equal(after.mixed.direction, 'rtl');
    assert.equal(await page.$eval('#mixed', (el) => el.getAttribute('dir')), 'auto');
    assert.ok(after.mixed.font.includes('VzxFa'));
    assert.equal(after.mixed.align, 'start');
    assert.equal(await page.$eval('#important-direction', (el) => getComputedStyle(el).direction), 'rtl');
    assert.equal(await page.$eval('#heading', (el) => getComputedStyle(el).textAlign), 'center');
  });
  await check('flex/grid/sidebar/composer keep their horizontal position and direction', async () => {
    for (const id of ['app', 'toolbar', 'main', 'sidebar', 'avatar', 'composer', 'send', 'grid']) {
      assert.equal(after[id].direction, before[id].direction, id);
      assert.ok(Math.abs(after[id].x - before[id].x) < 0.1, id);
      assert.ok(Math.abs(after[id].width - before[id].width) < 0.1, id);
    }
    assert.ok(after.grid1.x < after.grid2.x);
  });
  await check('table columns keep their order while Persian cells use RTL', async () => {
    assert.equal(after.table.direction, before.table.direction);
    assert.ok(after.col1.x < after.col2.x);
    assert.equal(await page.$eval('#cell1', (el) => getComputedStyle(el).direction), 'rtl');
  });
  await check('English text, code, math, icons, and controls keep their original fonts', async () => {
    for (const id of ['english', 'inline-code', 'code-block', 'formula', 'math', 'inline-icon', 'nav-button']) {
      assert.equal(after[id].font, before[id].font, id);
    }
    assert.equal(after.english.direction, before.english.direction);
    assert.equal(await page.$eval('#code-only', (el) => el.hasAttribute('data-vzx-d')), false);
    assert.equal(await page.$eval('#code-editor', (el) => !!el.querySelector('[data-vzx-d], [data-vzx-f]')), false);
  });
  await check('Persian lists have right-side indentation; English entries keep LTR', async () => {
    const list = await page.$eval('#steps', (el) => {
      const style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return { direction: style.direction, left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), safe: [...el.children].every((item) => item.getBoundingClientRect().right <= rect.right - 20) };
    });
    assert.equal(list.direction, 'rtl');
    assert.equal(list.left, 0);
    assert.ok(list.right >= 24 && list.safe);
    assert.equal(await page.$eval('#english-item', (el) => getComputedStyle(el).direction), 'ltr');
    assert.equal(await page.$eval('#url', (el) => getComputedStyle(el).direction), 'ltr');
    assert.equal(await page.$eval('#nested-english', (el) => getComputedStyle(el).direction), 'ltr');
    assert.equal(await page.$eval('#nested-english', (el) => parseFloat(getComputedStyle(el).paddingLeft)), 32);
    assert.equal(await page.$eval('#inline-button', (el) => getComputedStyle(el).direction), 'ltr');
  });
  await check('streamed text can change from English to Persian and back', async () => {
    await page.$eval('#stream', (el) => { el.firstChild.nodeValue = 'Windscribe: پاسخ فارسی در حال تولید'; });
    await pause(page);
    assert.equal(await page.$eval('#stream', (el) => getComputedStyle(el).direction), 'rtl');
    await page.$eval('#stream', (el) => { el.firstChild.nodeValue = 'The response is English now.'; });
    await pause(page);
    assert.equal(await page.$eval('#stream', (el) => el.hasAttribute('data-vzx-d') || el.hasAttribute('data-vzx-f')), false);
    await page.$eval('#stream', (el) => { el.textContent = 'پاسخ تازه'; });
    await pause(page);
    await page.$eval('#stream', (el) => { el.replaceChildren(); });
    await pause(page);
    assert.equal(await page.$eval('#stream', (el) => el.hasAttribute('data-vzx-d') || el.hasAttribute('data-vzx-f')), false);
  });
  await check('textarea and contenteditable follow typing in both languages and clear on empty', async () => {
    for (const id of ['input', 'editor']) {
      for (const [text, direction] of [['سلام دنیا', 'rtl'], ['Hello world', 'ltr'], ['', null]]) {
        await page.$eval(`#${id}`, (el, text) => {
          if ('value' in el) el.value = text; else el.textContent = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, text);
        await pause(page);
        assert.equal(await page.$eval(`#${id}`, (el) => el.getAttribute('data-vzx-d')), direction, id);
      }
    }
  });
  await check('new code inserted into an already Persian paragraph retains its font', async () => {
    await page.$eval('#inline', (el) => { const code = document.createElement('code'); code.id = 'new-code'; code.textContent = 'newCode()'; el.append(code); });
    await pause(page);
    assert.equal(await page.$eval('#new-code', (el) => getComputedStyle(el).fontFamily), before['inline-code'].font);
  });
  await check('changing a text block into a flex layout removes its RTL override', async () => {
    await page.$eval('#stream', (el) => { el.textContent = 'متن فارسی'; });
    await pause(page);
    await page.addStyleTag({ content: '.changed-layout {display:flex}' });
    await page.$eval('#stream', (el) => { el.className = 'changed-layout'; });
    await pause(page);
    assert.equal(await page.$eval('#stream', (el) => el.hasAttribute('data-vzx-d') || el.hasAttribute('data-vzx-f')), false);
  });
  await check('Latin-font setting changes Persian text without changing code or English-only text', async () => {
    await page.evaluate(() => patchSettings({ latinToo: true }));
    assert.ok((await page.$eval('#mixed', (el) => getComputedStyle(el).fontFamily)).includes('VzxAll'));
    assert.equal(await page.$eval('#inline-code', (el) => getComputedStyle(el).fontFamily), before['inline-code'].font);
    assert.equal(await page.$eval('#english', (el) => getComputedStyle(el).fontFamily), before.english.font);
    assert.equal(await page.$eval('#nested-english', (el) => getComputedStyle(el).fontFamily), before.english.font);
    await page.evaluate(() => patchSettings({ latinToo: false }));
  });
  await page.screenshot({ path: path.join(root, 'test-results', 'after.png'), fullPage: true });
  await check('turning off restores original direction, alignment, fonts, and property priorities', async () => {
    await page.evaluate(() => patchSettings({ enabled: false }));
    const restored = await snapshot();
    for (const id of Object.keys(before)) {
      for (const key of ['direction', 'align', 'font', 'dir', 'textAlign', 'textAlignPriority', 'fallback', 'fallbackPriority']) assert.equal(restored[id][key], before[id][key], `${id}.${key}`);
    }
    assert.equal(await page.locator('[data-vzx-d], [data-vzx-f], [data-vzx-list], [data-vzx-item], [data-vzx-align], [data-vzx-protected-font]').count(), 0);
    assert.equal(await page.locator('#vzx-style').count(), 0);
    assert.equal(await page.$eval('#important-direction', (el) => el.style.getPropertyValue('direction')), 'ltr');
    assert.equal(await page.$eval('#important-direction', (el) => el.style.getPropertyPriority('direction')), 'important');
  });
  await check('global, custom-host, and per-site switches update without a reload', async () => {
    await page.evaluate(() => patchSettings({ enabled: true, allSites: false }));
    assert.equal(await page.locator('#vzx-style').count(), 0);
    await page.evaluate(() => patchSettings({ customHosts: ['ai-rtl.test'] }));
    await pause(page);
    assert.equal(await page.locator('#mixed[data-vzx-d="rtl"]').count(), 1);
    await page.evaluate(() => patchSettings({ disabledHosts: ['ai-rtl.test'] }));
    assert.equal(await page.locator('#vzx-style').count(), 0);
    await page.evaluate(() => patchSettings({ disabledHosts: [] }));
    await pause(page);
    assert.equal(await page.locator('#mixed[data-vzx-d="rtl"]').count(), 1);
  });
  await check('narrow viewport keeps the composer and page within the viewport', async () => {
    await page.setViewportSize({ width: 760, height: 900 });
    await pause(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(root, 'test-results', 'narrow.png'), fullPage: true });
  });
  assert.deepEqual(errors, [], 'browser errors');
  console.log(`\n${results.length} browser regression checks passed.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
});
