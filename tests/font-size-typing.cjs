// Offline regression for Antigravity's Lexical composer, including its real
// transition-all duration-100 behavior. No live site or browser session is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const extension = path.resolve(__dirname, '..', 'ai-rtl');
const origin = 'https://antigravity.static.usercontent.goog';
const font = fs.readFileSync(path.join(extension, 'fonts', 'Vazirmatn-Variable.woff2'));
const failures = [];
const results = [];
let browser;

const fixture = `<!doctype html><html lang="en" dir="ltr"><meta charset="utf-8">
<title>Offline Antigravity font-size typing regression</title>
<style>
  body { font:16px/1.5 Arial,sans-serif; margin:30px; }
  .composer { display:flex; gap:12px; margin:20px 0; }
  [contenteditable], textarea { border:1px solid #999; padding:8px; min-height:32px; width:480px; }
  [contenteditable] { font-size:14px; white-space:pre-wrap; word-break:break-word; outline:none; }
  [data-lexical-editor] { transition:all .1s; }
  textarea { font:16px Arial,sans-serif; transition:all .1s; }
  #plain { transition:none; }
  #response { font-size:20px; transition:font-size .1s; }
  #relative { font-size:.75em; transition:all .1s; }
  button { font:13px Arial,sans-serif; }
</style>
<div class="composer"><div id="lexical" aria-label="Message input" contenteditable="true" role="combobox" data-lexical-editor="true"><p dir="auto"><span data-lexical-text="true">برای</span></p></div><button>Send</button></div>
<div class="composer"><div id="plain" contenteditable="true">برای</div></div>
<div class="composer"><textarea id="textarea">برای</textarea></div>
<div class="composer"><div id="native" contenteditable="true" data-lexical-editor="true">متن</div></div>
<article><p id="response">پاسخ فارسی با <strong id="inherited">متن برجسته</strong> و <span id="relative">متن کوچک‌تر</span></p></article>
</html>`;

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < .06, `${message}: expected ${expected}px, got ${actual}px`);
}

async function settle(page) {
  // The app's 100ms transition must finish between words to reproduce the real
  // feedback loop: measurement must use the native size, never the old target.
  await page.waitForTimeout(140);
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

async function check(name, callback) {
  try {
    await callback();
    results.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function inspect(page, selector) {
  return page.locator(selector).evaluate(el => {
    const textParent = el.querySelector('[data-lexical-text]') || el;
    return {
      size: parseFloat(getComputedStyle(el).fontSize),
      textSize: parseFloat(getComputedStyle(textParent).fontSize),
      target: el.style.getPropertyValue('--vzx-size'),
      font: getComputedStyle(el).fontFamily,
      inlineSize: el.style.getPropertyValue('font-size'),
      transition: getComputedStyle(el).transitionProperty,
      duration: getComputedStyle(el).transitionDuration
    };
  });
}

async function typeWords(page, selector) {
  await page.locator(selector).focus();
  await page.keyboard.press('End');
  await settle(page);
  const frames = [];
  for (const word of [' سلام', ' به', ' ایران', ' تست', ' اندازه', ' ثابت']) {
    await page.keyboard.insertText(word);
    await settle(page);
    frames.push(await inspect(page, selector));
  }
  console.log(`${selector} settled sizes: ${frames.map(frame => frame.size).join(', ')}`);
  return frames;
}

(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width:1200, height:1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url === `${origin}/`) await route.fulfill({ contentType:'text/html; charset=utf-8', body:fixture });
    else if (url === `${origin}/fonts/Vazirmatn-Variable.woff2`) await route.fulfill({ contentType:'font/woff2', body:font });
    else await route.abort();
  });
  await page.goto(`${origin}/`);

  // Ask Chromium's own editing engine to create a formatting span. This is an
  // actual native inline font-size, not extension markup and must stay intact.
  const nativeBefore = await page.locator('#native').evaluate(el => {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('fontSize', false, '5');
    getSelection().collapseToEnd();
    const span = el.querySelector('[style*="font-size"]');
    if (!span) throw new Error('Chromium did not insert the expected native font-size span');
    span.id = 'native-span';
    return { inline:span.style.fontSize, size:parseFloat(getComputedStyle(span).fontSize),
      outer:el.getAttribute('style'), transition:getComputedStyle(el).transitionProperty,
      duration:getComputedStyle(el).transitionDuration };
  });
  await page.evaluate(origin => {
    const listeners = [];
    const state = { fontSizes:{ 'antigravity.google.com':110 } };
    window.chrome = { runtime:{ getURL:resource => `${origin}/${resource}` }, storage:{
      sync:{ get:(defaults, callback) => callback({ ...defaults, ...state }) },
      onChanged:{ addListener:listener => listeners.push(listener) }
    } };
    window.patchSettings = patch => {
      const changes = Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { newValue }]));
      Object.assign(state, patch);
      listeners.forEach(listener => listener(changes, 'sync'));
    };
  }, origin);
  for (const file of ['hosts.js', 'content.js']) await page.addScriptTag({ path:path.join(extension, file) });
  await page.evaluate(() => document.fonts.ready);
  await settle(page);

  await check('Antigravity Lexical transition-all composer stays 110% through every typed word', async () => {
    const frames = await typeWords(page, '#lexical');
    for (const [index, frame] of frames.entries()) {
      near(frame.size, 15.4, `word ${index + 1} editor`);
      near(frame.textSize, 15.4, `word ${index + 1} inherited Lexical span`);
      assert.ok(frame.font.includes('VzxFa'));
    }
  });

  await check('textarea font-size transitions stay at the configured scale during typing', async () => {
    for (const [index, frame] of (await typeWords(page, '#textarea')).entries()) {
      near(frame.size, 17.6, `textarea word ${index + 1}`);
    }
  });

  await check('nonanimated editable retains the same size through typing', async () => {
    for (const [index, frame] of (await typeWords(page, '#plain')).entries()) {
      near(frame.size, 15.4, `plain editor word ${index + 1}`);
    }
  });

  await check('repeated scans preserve animated prose hierarchy and relative nested sizes', async () => {
    const frames = [];
    for (let index = 0; index < 6; index++) {
      await page.locator('#response').evaluate((el, index) => { el.className = `stream-state-${index}`; }, index);
      await settle(page);
      frames.push(await page.evaluate(() => Object.fromEntries(['response', 'inherited', 'relative'].map(id =>
        [id, parseFloat(getComputedStyle(document.getElementById(id)).fontSize)]))));
    }
    console.log(`response settled sizes: ${frames.map(frame => frame.response).join(', ')}`);
    for (const frame of frames) {
      near(frame.response, 22, 'prose paragraph');
      near(frame.inherited, 22, 'inherited strong');
      near(frame.relative, 16.5, 'relative nested span');
    }
  });

  await check('native browser-inserted font-size formatting remains stable and untouched', async () => {
    await typeWords(page, '#native');
    const native = await page.locator('#native-span').evaluate(el => ({ inline:el.style.fontSize,
      size:parseFloat(getComputedStyle(el).fontSize) }));
    assert.equal(native.inline, nativeBefore.inline, 'native inline CSS must not be removed or rewritten');
    near(native.size, nativeBefore.size, 'native explicit font-size');
  });

  await check('scale changes and reset use native sizes while preserving site transitions', async () => {
    for (const [scale, expectedEditor, expectedText] of [[150, 21, 24], [80, 11.2, 12.8], [100, 14, 16]]) {
      await page.evaluate(scale => patchSettings({ fontSizes:{ 'antigravity.google.com':scale } }), scale);
      await settle(page);
      near((await inspect(page, '#lexical')).size, expectedEditor, `${scale}% Lexical`);
      near((await inspect(page, '#textarea')).size, expectedText, `${scale}% textarea`);
      if (scale !== 100) {
        for (const frame of await typeWords(page, '#lexical')) {
          near(frame.size, expectedEditor, `${scale}% Lexical after typing`);
          near(frame.textSize, expectedEditor, `${scale}% inherited Lexical text after typing`);
        }
        for (const frame of await typeWords(page, '#textarea')) {
          near(frame.size, expectedText, `${scale}% textarea after typing`);
        }
      }
    }
    await page.evaluate(() => patchSettings({ enabled:false }));
    await settle(page);
    const restored = await inspect(page, '#native');
    assert.equal(restored.inlineSize, '', 'the editor never had an inline font-size');
    assert.equal(restored.transition, nativeBefore.transition);
    assert.equal(restored.duration, nativeBefore.duration);
    assert.equal(await page.locator('#native-span').evaluate(el => el.style.fontSize), nativeBefore.inline);
    assert.equal(await page.locator('[data-vzx-f], [data-vzx-size], #vzx-style').count(), 0);
    assert.equal(await page.locator(':root[data-vzx-measure-size], :root[data-vzx-size-transition]').count(), 0);
    assert.deepEqual(errors, []);
  });

  console.log(`\n${results.length} font-size typing checks passed; ${failures.length} failed.`);
  assert.deepEqual(failures, [], 'font-size typing regressions');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); });
